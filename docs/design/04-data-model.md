# 04 · 数据库设计

> 关联：`03-domain-model.md`（领域模型）
> 数据库：PostgreSQL 17（容器 `postgres:17-alpine`）
> 命名：小写下划线蛇形；主键 `id`；外键 `<单数实体>_id`；时间列 `timestamptz` 一律存 UTC

---

## 1. 设计规约

### 1.1 Schema 划分

| Schema | 内容 | 应用账号权限 |
|---|---|---|
| `iam` | 用户、角色、权限、令牌、用户-标签关联 | 全读写 |
| `catalog` | 标签、题目、题库、导入批次 | 全读写 |
| `authoring` | 试卷、题位、组卷方案、快照、模板 | 全读写 |
| `delivery` | 场次、名单、会话、答案、焦点事件、监考动作 | 全读写 |
| `grading` | 评分结果、阅卷任务、成绩发布、成绩修订 | 全读写 |
| `learning` | 错题、能力画像、练习开放单、练习结果 | 全读写 |
| `analytics` | 统计读模型 | 全读写 |
| `audit` | 审计日志 | **仅 INSERT + SELECT** |
| `app` | 追加式流水（答案修订、焦点事件、成绩修订） | **仅 INSERT + SELECT** |
| `outbox` | 领域事件出站箱 | 全读写 |

分 Schema 的收益：追加式表集中在一个 schema，可用一条 `REVOKE UPDATE, DELETE ON ALL TABLES IN SCHEMA app FROM exam_app` 实现 DB 级不可篡改（P-05）。

### 1.2 通用列

所有业务表（`audit.app` 除外）包含：

```sql
id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
created_at   timestamptz NOT NULL DEFAULT now(),
created_by   bigint NULL,
updated_at   timestamptz NULL,
updated_by   bigint NULL,
deleted_at   timestamptz NULL          -- 全局软删除；append-only 表不设
version      integer NOT NULL DEFAULT 1   -- 乐观并发（配合 xmin 可省略，见 1.3）
```

### 1.3 乐观并发

采用 PostgreSQL 的 `xmin` 系统列：

```sql
-- EF Core 映射
entity.Property(e => e.Version).IsRowVersion();
```

EF Core 把 `xmin` 映射为 `bytea` 并自动在 UPDATE 的 WHERE 中比对，**无需额外的物理列**（因此通用列清单中**没有** `version` 物理列，`Version` 是 `xmin` 的映射属性）。冲突抛 `DbUpdateConcurrencyException`。

### 1.4 索引规约

- 所有外键列建索引。
- 高频过滤列建复合索引，遵循"等值列在前、范围列在后"。
- 唯一约束优先于唯一索引（语义更清晰，错误信息更好）。
- 全文检索用 `tsvector` 生成列 + GIN 索引（题干、解析）。

### 1.5 枚举规约

用 `text` + `CHECK` 约束而非 PG `enum` 类型：PG enum 增删值需要 `ALTER TYPE`，迁移易出错；`text + CHECK` 的迁移只是改约束。

```sql
status text NOT NULL CHECK (status IN ('draft','published','disabled'))
```

---

## 2. ER 概览

```
iam.user ──< iam.user_tag >── catalog.tag（组织维度标签）
iam.user >──< iam.user_role >── iam.role >──< iam.role_permission >── iam.permission
iam.refresh_token (user_id, family_id)

catalog.tag ──< catalog.question_tag >── catalog.question
catalog.question ──< catalog.question_option
catalog.question ──< catalog.question_keypoint
catalog.question ──< catalog.question_step
catalog.question ──< catalog.question_attachment
catalog.question_bank ──< catalog.question_bank_item >── catalog.question
catalog.import_batch ──< catalog.import_row

authoring.paper ──< authoring.paper_item >── catalog.question
authoring.paper ──< authoring.paper_section
authoring.paper ──< authoring.blueprint
authoring.paper ──< authoring.paper_snapshot >──< authoring.snapshot_item
authoring.paper_template ──< authoring.template_item

delivery.exam_session ──< delivery.exam_participant >── iam.user
delivery.exam_session ──> authoring.paper_snapshot
delivery.attempt >── delivery.exam_session
delivery.attempt >── delivery.practice_assignment (learning)
delivery.attempt ──< delivery.answer >── catalog.question
delivery.attempt ──< app.answer_revision
delivery.attempt ──< app.focus_event
delivery.attempt ──< delivery.proctor_action

grading.score_result >── delivery.attempt
grading.score_result >── catalog.question
grading.review_task >── delivery.attempt
grading.grade_publication >── delivery.exam_session
app.grade_revision >── grading.score_result

learning.mistake >── iam.user / catalog.question
learning.ability_profile >── iam.user / catalog.tag
learning.practice_assignment ──< delivery.attempt
```

---

## 3. IAM Schema

### 3.1 `iam.user_tag`（用户 ↔ 组织维度标签）

用户的组织归属不单独存字段，而是通过关联表挂载**组织维度标签**（院系 / 专业 / 班级）。查询"所属组织"时由标签树上溯推导。**社会人士不挂任何组织标签**，该关联表对其为空。

```sql
-- 注：本表引用 catalog.tag（见 §4.1），EF 迁移会自动处理建表顺序
CREATE TABLE iam.user_tag (
    user_id     bigint NOT NULL REFERENCES iam.user(id) ON DELETE CASCADE,
    tag_id      bigint NOT NULL REFERENCES catalog.tag(id),
    assigned_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, tag_id)
);
CREATE INDEX ix_user_tag_tag ON iam.user_tag(tag_id, user_id);
```

约束：`tag_id` 指向的标签必须 `group_name = 'organization'`，由应用层保证（领域方法 `User.AssignTags` 校验）。

### 3.2 `iam.user`

```sql
CREATE TABLE iam.user (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username            text NOT NULL,
    display_name        text NOT NULL,
    password_hash       text NOT NULL,
    email               text NULL,
    phone               text NULL,
    status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','locked','disabled')),
    must_change_password boolean NOT NULL DEFAULT false,
    failed_login_count  integer NOT NULL DEFAULT 0,
    locked_until        timestamptz NULL,
    last_login_at       timestamptz NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by          bigint NULL,
    updated_at          timestamptz NULL,
    updated_by          bigint NULL,
    deleted_at          timestamptz NULL,
    CONSTRAINT ck_user_username_format CHECK (username ~ '^[A-Za-z0-9_.-]{4,32}$')
);
CREATE UNIQUE INDEX uq_user_username ON iam.user(lower(username)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_user_email ON iam.user(email) WHERE deleted_at IS NULL AND email IS NOT NULL;
CREATE INDEX ix_user_status ON iam.user(status);
```

### 3.3 `iam.role` / `iam.permission` / 关联表

```sql
CREATE TABLE iam.role (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        text NOT NULL,
    name        text NOT NULL,
    description text NULL,
    is_system   boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NULL,
    deleted_at  timestamptz NULL
);
CREATE UNIQUE INDEX uq_role_code ON iam.role(code) WHERE deleted_at IS NULL;

CREATE TABLE iam.permission (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        text NOT NULL,
    name        text NOT NULL,
    module      text NOT NULL,
    description text NULL
);
CREATE UNIQUE INDEX uq_permission_code ON iam.permission(code);

CREATE TABLE iam.role_permission (
    role_id       bigint NOT NULL REFERENCES iam.role(id),
    permission_id bigint NOT NULL REFERENCES iam.permission(id),
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE iam.user_role (
    user_id     bigint NOT NULL REFERENCES iam.user(id),
    role_id     bigint NOT NULL REFERENCES iam.role(id),
    granted_by  bigint NULL,
    granted_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_id)
);
```

### 3.4 `iam.refresh_token`

```sql
CREATE TABLE iam.refresh_token (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id            bigint NOT NULL REFERENCES iam.user(id),
    token_hash         text NOT NULL,
    family_id          uuid NOT NULL,
    expires_at         timestamptz NOT NULL,
    revoked_at         timestamptz NULL,
    revoke_reason      text NULL CHECK (revoke_reason IN ('rotated','logout','reuse_detected','password_changed','user_disabled')),
    replaced_by_id     bigint NULL REFERENCES iam.refresh_token(id),
    created_by_ip      inet NULL,
    user_agent         text NULL,
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_refresh_token_hash ON iam.refresh_token(token_hash);
CREATE INDEX ix_refresh_token_family ON iam.refresh_token(family_id);
CREATE INDEX ix_refresh_token_user ON iam.refresh_token(user_id, expires_at);
```

### 3.5 `iam.login_attempt`（防暴力破解与审计）

```sql
CREATE TABLE iam.login_attempt (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username    text NOT NULL,
    succeeded   boolean NOT NULL,
    reason      text NULL,
    ip          inet NULL,
    user_agent  text NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_login_attempt_username_time ON iam.login_attempt(username, created_at DESC);
```

---

## 4. Catalog Schema

### 4.1 `catalog.tag`

```sql
CREATE TABLE catalog.tag (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        text NOT NULL,
    name        text NOT NULL,
    group_name  text NOT NULL CHECK (group_name IN ('domain','knowledge_point','ability','difficulty','organization')),
    parent_id   bigint NULL REFERENCES catalog.tag(id),
    level       integer NULL CHECK (level BETWEEN 1 AND 5),
    description text NULL,
    sort_order  integer NOT NULL DEFAULT 0,
    is_system   boolean NOT NULL DEFAULT false,
    usage_count integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  bigint NULL,
    updated_at  timestamptz NULL,
    updated_by  bigint NULL,
    deleted_at  timestamptz NULL,
    CONSTRAINT ck_tag_level_by_group CHECK (
        (group_name = 'difficulty' AND level IS NOT NULL AND parent_id IS NULL) OR
        (group_name <> 'difficulty' AND level IS NULL)
    )
);
CREATE UNIQUE INDEX uq_tag_code ON catalog.tag(code) WHERE deleted_at IS NULL;
CREATE INDEX ix_tag_group ON catalog.tag(group_name) WHERE deleted_at IS NULL;
CREATE INDEX ix_tag_parent ON catalog.tag(parent_id);
```

### 4.2 `catalog.question`

```sql
CREATE TABLE catalog.question (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code               text NOT NULL,
    type               text NOT NULL CHECK (type IN ('single','multi','judge','short','comprehensive')),
    stem               text NOT NULL,
    default_score      numeric(6,2) NOT NULL CHECK (default_score > 0 AND default_score <= 40),
    status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','disabled')),
    source             text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import','generated')),
    analysis           text NULL,
    reference_answer   text NULL,
    difficulty_tag_id  bigint NOT NULL REFERENCES catalog.tag(id),
    batch_id           bigint NULL,
    published_at       timestamptz NULL,
    stem_tsv           tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(stem,''))) STORED,
    created_at         timestamptz NOT NULL DEFAULT now(),
    created_by         bigint NULL,
    updated_at         timestamptz NULL,
    updated_by         bigint NULL,
    deleted_at         timestamptz NULL
);
CREATE UNIQUE INDEX uq_question_code ON catalog.question(code) WHERE deleted_at IS NULL;
CREATE INDEX ix_question_status_type ON catalog.question(status, type) WHERE deleted_at IS NULL;
CREATE INDEX ix_question_difficulty ON catalog.question(difficulty_tag_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_question_batch ON catalog.question(batch_id);
CREATE INDEX ix_question_stem_tsv ON catalog.question USING gin(stem_tsv);
```

> `difficulty_tag_id` 是 P-04 允许的冗余列，由 `Question.SetDifficulty` 领域行为同步；`catalog.question_tag` 中**不重复**存放难度标签，避免两处不一致。

### 4.3 `catalog.question_tag`

```sql
CREATE TABLE catalog.question_tag (
    question_id bigint NOT NULL REFERENCES catalog.question(id),
    tag_id      bigint NOT NULL REFERENCES catalog.tag(id),
    assigned_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (question_id, tag_id)
);
CREATE INDEX ix_question_tag_tag ON catalog.question_tag(tag_id, question_id);
```

### 4.4 `catalog.question_option` / `question_keypoint` / `question_step` / `question_attachment`

```sql
CREATE TABLE catalog.question_option (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    question_id bigint NOT NULL REFERENCES catalog.question(id) ON DELETE CASCADE,
    option_key  text NOT NULL CHECK (option_key IN ('A','B','C','D','E','F')),
    text        text NOT NULL,
    is_correct  boolean NOT NULL DEFAULT false,
    sort_order  integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_question_option_key ON catalog.question_option(question_id, option_key);
CREATE INDEX ix_question_option_q ON catalog.question_option(question_id);

CREATE TABLE catalog.question_keypoint (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    question_id bigint NOT NULL REFERENCES catalog.question(id) ON DELETE CASCADE,
    text        text NOT NULL,
    keywords    text[] NOT NULL DEFAULT '{}',
    sort_order  integer NOT NULL DEFAULT 0
);
CREATE INDEX ix_question_keypoint_q ON catalog.question_keypoint(question_id);

CREATE TABLE catalog.question_step (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    question_id      bigint NOT NULL REFERENCES catalog.question(id) ON DELETE CASCADE,
    step_code        text NOT NULL,
    prompt           text NOT NULL,
    reference_answer text NULL,
    keywords         text[] NOT NULL DEFAULT '{}',
    score            numeric(6,2) NOT NULL CHECK (score > 0),
    sort_order       integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_question_step_code ON catalog.question_step(question_id, step_code);
CREATE INDEX ix_question_step_q ON catalog.question_step(question_id);

CREATE TABLE catalog.question_attachment (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    question_id bigint NOT NULL REFERENCES catalog.question(id) ON DELETE CASCADE,
    object_key  text NOT NULL,       -- 对象存储键
    file_name   text NOT NULL,
    content_type text NOT NULL,
    size_bytes  bigint NOT NULL,
    sort_order  integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz NULL
);
CREATE INDEX ix_question_attachment_q ON catalog.question_attachment(question_id);
```

### 4.5 `catalog.question_bank` / `question_bank_item`

```sql
CREATE TABLE catalog.question_bank (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        text NOT NULL,
    description text NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  bigint NULL,
    updated_at  timestamptz NULL,
    updated_by  bigint NULL,
    deleted_at  timestamptz NULL
);
CREATE UNIQUE INDEX uq_question_bank_name ON catalog.question_bank(name) WHERE deleted_at IS NULL;

CREATE TABLE catalog.question_bank_item (
    bank_id    bigint NOT NULL REFERENCES catalog.question_bank(id) ON DELETE CASCADE,
    question_id bigint NOT NULL REFERENCES catalog.question(id),
    added_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (bank_id, question_id)
);
CREATE INDEX ix_question_bank_item_q ON catalog.question_bank_item(question_id);
```

### 4.6 `catalog.import_batch` / `import_row` / `generation_batch`

```sql
CREATE TABLE catalog.import_batch (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    file_name      text NOT NULL,
    file_type      text NOT NULL CHECK (file_type IN ('csv','xlsx')),
    column_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
    status         text NOT NULL DEFAULT 'parsed' CHECK (status IN ('parsed','adopted','failed')),
    total_rows     integer NOT NULL DEFAULT 0,
    valid_rows     integer NOT NULL DEFAULT 0,
    invalid_rows   integer NOT NULL DEFAULT 0,
    adopted_count  integer NOT NULL DEFAULT 0,
    operator_id    bigint NOT NULL,
    adopted_by     bigint NULL,
    adopted_at     timestamptz NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    deleted_at     timestamptz NULL
);

CREATE TABLE catalog.import_row (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_id    bigint NOT NULL REFERENCES catalog.import_batch(id) ON DELETE CASCADE,
    row_number  integer NOT NULL,
    raw         jsonb NOT NULL,
    parsed      jsonb NULL,
    errors      jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_import_row_batch_no ON catalog.import_row(batch_id, row_number);
```

`generation_batch` 结构类似，含 `prompt`、`question_type`、`difficulty_tag_id`、`quantity`、`tag_ids int[]`、`provider`、`status`。

---

## 5. Authoring Schema

### 5.1 `authoring.paper`

```sql
CREATE TABLE authoring.paper (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind              text NOT NULL CHECK (kind IN ('exam','practice')),
    name              text NOT NULL,
    batch             text NULL,
    description       text NULL,
    total_score       numeric(8,2) NOT NULL DEFAULT 0,
    duration_minutes  integer NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 1 AND 300),
    pass_score        numeric(8,2) NULL,
    status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
    order_rule        text NOT NULL DEFAULT 'by_type' CHECK (order_rule IN ('by_type','manual')),
    variant_rule      text NOT NULL DEFAULT 'standard' CHECK (variant_rule IN ('standard','small_plum','large_plum')),
    answer_policy     text NOT NULL DEFAULT 'after_close' CHECK (answer_policy IN ('immediately','after_submit','after_close')),
    allow_retake      boolean NOT NULL DEFAULT false,
    retake_keeps_best boolean NOT NULL DEFAULT true,
    note              text NULL,
    exam_rules        jsonb NULL,
    practice_rules    jsonb NULL,
    published_snapshot_id bigint NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        bigint NULL,
    updated_at        timestamptz NULL,
    updated_by        bigint NULL,
    deleted_at        timestamptz NULL,
    CONSTRAINT ck_paper_rules_exclusive CHECK (
        (kind = 'exam' AND exam_rules IS NOT NULL AND practice_rules IS NULL) OR
        (kind = 'practice' AND practice_rules IS NOT NULL AND exam_rules IS NULL)
    )
);
CREATE INDEX ix_paper_kind_status ON authoring.paper(kind, status) WHERE deleted_at IS NULL;
```

### 5.2 `authoring.paper_item` / `paper_section` / `paper_tag`

```sql
CREATE TABLE authoring.paper_section (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    paper_id    bigint NOT NULL REFERENCES authoring.paper(id) ON DELETE CASCADE,
    title       text NOT NULL,
    instructions text NULL,
    sort_order  integer NOT NULL DEFAULT 0
);
CREATE INDEX ix_paper_section_paper ON authoring.paper_section(paper_id);

CREATE TABLE authoring.paper_item (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    paper_id     bigint NOT NULL REFERENCES authoring.paper(id) ON DELETE CASCADE,
    question_id  bigint NOT NULL REFERENCES catalog.question(id),
    score        numeric(6,2) NOT NULL CHECK (score >= 0 AND score <= 40),
    sort_order   integer NOT NULL,
    section_id   bigint NULL REFERENCES authoring.paper_section(id)
);
CREATE UNIQUE INDEX uq_paper_item_question ON authoring.paper_item(paper_id, question_id);
CREATE INDEX ix_paper_item_paper_order ON authoring.paper_item(paper_id, sort_order);
CREATE INDEX ix_paper_item_question ON authoring.paper_item(question_id);

CREATE TABLE authoring.paper_tag (
    paper_id bigint NOT NULL REFERENCES authoring.paper(id) ON DELETE CASCADE,
    tag_id   bigint NOT NULL REFERENCES catalog.tag(id),
    PRIMARY KEY (paper_id, tag_id)
);
CREATE INDEX ix_paper_tag_tag ON authoring.paper_tag(tag_id);
```

### 5.3 `authoring.blueprint`

```sql
CREATE TABLE authoring.blueprint (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    paper_id        bigint NOT NULL REFERENCES authoring.paper(id) ON DELETE CASCADE,
    rules           jsonb NOT NULL,
    seed            text NOT NULL,
    status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','generated','modified')),
    manual_modified boolean NOT NULL DEFAULT false,
    shortfalls      jsonb NOT NULL DEFAULT '[]'::jsonb,
    generated_at    timestamptz NULL,
    generated_by    bigint NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NULL,
    deleted_at      timestamptz NULL
);
CREATE INDEX ix_blueprint_paper ON authoring.blueprint(paper_id);
```

### 5.4 `authoring.paper_snapshot` / `snapshot_item`

```sql
CREATE TABLE authoring.paper_snapshot (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    paper_id     bigint NOT NULL REFERENCES authoring.paper(id),
    version      integer NOT NULL,
    content_hash text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   bigint NULL
);
CREATE UNIQUE INDEX uq_snapshot_paper_version ON authoring.paper_snapshot(paper_id, version);

CREATE TABLE authoring.snapshot_item (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    snapshot_id      bigint NOT NULL REFERENCES authoring.paper_snapshot(id) ON DELETE CASCADE,
    question_id      bigint NOT NULL,
    question_code    text NOT NULL,
    question_type    text NOT NULL,
    stem             text NOT NULL,
    options          jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{key,text}]
    correct_keys     text[] NOT NULL DEFAULT '{}',
    keypoints        jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{text,keywords}]
    steps            jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{code,prompt,referenceAnswer,keywords,score}]
    analysis         text NULL,
    reference_answer text NULL,
    attachments      jsonb NOT NULL DEFAULT '[]'::jsonb,
    score            numeric(6,2) NOT NULL,
    sort_order       integer NOT NULL,
    section_title    text NULL
);
CREATE INDEX ix_snapshot_item_snapshot ON authoring.snapshot_item(snapshot_id, sort_order);
```

### 5.5 `authoring.paper_template` / `template_item`

结构类似 paper（无状态机），`template_item` 存 `question_id` + `score` + `sort_order`。

---

## 6. Delivery Schema

### 6.1 `delivery.exam_session`

```sql
CREATE TABLE delivery.exam_session (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    paper_id          bigint NOT NULL REFERENCES authoring.paper(id),
    snapshot_id       bigint NOT NULL REFERENCES authoring.paper_snapshot(id),
    name              text NOT NULL,
    open_at           timestamptz NOT NULL,
    close_at          timestamptz NOT NULL,
    duration_minutes  integer NOT NULL CHECK (duration_minutes > 0),
    status            text NOT NULL DEFAULT 'scheduled'
                      CHECK (status IN ('scheduled','in_progress','closed','cancelled')),
    variant_rule      text NOT NULL DEFAULT 'standard',
    rules             jsonb NOT NULL DEFAULT '{}'::jsonb,
    note              text NULL,
    published_at      timestamptz NULL,
    closed_at         timestamptz NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        bigint NULL,
    updated_at        timestamptz NULL,
    updated_by        bigint NULL,
    deleted_at        timestamptz NULL,
    CONSTRAINT ck_exam_session_window CHECK (open_at < close_at)
);
CREATE INDEX ix_exam_session_status ON delivery.exam_session(status, open_at);
```

### 6.2 `delivery.exam_participant`

```sql
CREATE TABLE delivery.exam_participant (
    exam_session_id bigint NOT NULL REFERENCES delivery.exam_session(id) ON DELETE CASCADE,
    user_id         bigint NOT NULL REFERENCES iam.user(id),
    status          text NOT NULL DEFAULT 'invited'
                    CHECK (status IN ('invited','not_started','in_progress','submitted','absent','disqualified')),
    attempts_used   integer NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (exam_session_id, user_id)
);
CREATE INDEX ix_exam_participant_user ON delivery.exam_participant(user_id);
```

### 6.3 `delivery.attempt`

```sql
CREATE TABLE delivery.attempt (
    id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    target_type          text NOT NULL CHECK (target_type IN ('exam','practice')),
    exam_session_id      bigint NULL REFERENCES delivery.exam_session(id),
    practice_assignment_id bigint NULL REFERENCES learning.practice_assignment(id),
    user_id              bigint NOT NULL REFERENCES iam.user(id),
    attempt_no           integer NOT NULL DEFAULT 1,
    status               text NOT NULL DEFAULT 'not_started'
                         CHECK (status IN ('not_started','in_progress','submitted','auto_submitted','force_submitted','abandoned')),
    started_at           timestamptz NULL,
    deadline_at          timestamptz NOT NULL,
    submitted_at         timestamptz NULL,
    submit_reason        text NULL CHECK (submit_reason IN ('manual','time_up','proctor_force','admin_force','network_timeout')),
    last_saved_at        timestamptz NULL,
    last_client_seq      integer NOT NULL DEFAULT 0,
    focus_loss_count     integer NOT NULL DEFAULT 0,
    disconnect_count     integer NOT NULL DEFAULT 0,
    warning_count        integer NOT NULL DEFAULT 0,
    variant_key          text NULL,
    variant_seed         text NULL,
    duration_spent_seconds integer NULL,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NULL,
    deleted_at           timestamptz NULL,
    CONSTRAINT ck_attempt_target CHECK (
        (target_type = 'exam' AND exam_session_id IS NOT NULL AND practice_assignment_id IS NULL) OR
        (target_type = 'practice' AND practice_assignment_id IS NOT NULL AND exam_session_id IS NULL)
    )
);
CREATE UNIQUE INDEX uq_attempt_exam_user_no ON delivery.attempt(exam_session_id, user_id, attempt_no)
    WHERE target_type = 'exam' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_attempt_practice_user_no ON delivery.attempt(practice_assignment_id, user_id, attempt_no)
    WHERE target_type = 'practice' AND deleted_at IS NULL;
CREATE INDEX ix_attempt_user ON delivery.attempt(user_id, created_at DESC);
CREATE INDEX ix_attempt_session_status ON delivery.attempt(exam_session_id, status);
CREATE INDEX ix_attempt_active ON delivery.attempt(status, deadline_at) WHERE status = 'in_progress';
```

### 6.4 `delivery.answer`（当前值）

```sql
CREATE TABLE delivery.answer (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    attempt_id    bigint NOT NULL REFERENCES delivery.attempt(id) ON DELETE CASCADE,
    question_id   bigint NOT NULL REFERENCES catalog.question(id),
    paper_item_id bigint NULL,
    payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_blank      boolean NOT NULL DEFAULT true,
    revision      integer NOT NULL DEFAULT 1,
    client_seq    integer NOT NULL,
    saved_at      timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_answer_attempt_question ON delivery.answer(attempt_id, question_id);
CREATE INDEX ix_answer_attempt ON delivery.answer(attempt_id);
```

### 6.5 `app.answer_revision`（追加式流水）

```sql
CREATE TABLE app.answer_revision (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    attempt_id          bigint NOT NULL,
    question_id         bigint NOT NULL,
    client_seq          integer NOT NULL,
    payload             jsonb NOT NULL,
    revision            integer NOT NULL,
    client_sent_at      timestamptz NULL,
    server_received_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_answer_revision_seq ON app.answer_revision(attempt_id, client_seq);
CREATE INDEX ix_answer_revision_attempt ON app.answer_revision(attempt_id, server_received_at DESC);
```

**权限**：`REVOKE UPDATE, DELETE ON ALL TABLES IN SCHEMA app FROM exam_app;`

### 6.6 `app.focus_event`

```sql
CREATE TABLE app.focus_event (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    attempt_id         bigint NOT NULL,
    event_type         text NOT NULL CHECK (event_type IN
                       ('window_blur','page_hidden','fullscreen_exit','copy_attempt','paste_attempt','context_menu','heartbeat_timeout')),
    question_id        bigint NULL,
    client_at          timestamptz NULL,
    server_received_at timestamptz NOT NULL DEFAULT now(),
    meta               jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ix_focus_event_attempt ON app.focus_event(attempt_id, server_received_at DESC);
```

### 6.7 `delivery.proctor_action`

```sql
CREATE TABLE delivery.proctor_action (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    attempt_id      bigint NOT NULL REFERENCES delivery.attempt(id) ON DELETE CASCADE,
    exam_session_id bigint NOT NULL REFERENCES delivery.exam_session(id),
    action_type     text NOT NULL CHECK (action_type IN ('warn','note','force_submit')),
    message         text NULL,
    reason          text NULL,
    operator_id     bigint NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_proctor_action_attempt ON delivery.proctor_action(attempt_id, created_at DESC);
```

### 6.8 `learning.practice_assignment`

```sql
CREATE TABLE learning.practice_assignment (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    paper_id    bigint NOT NULL REFERENCES authoring.paper(id),
    title       text NOT NULL,
    status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
    rules       jsonb NOT NULL DEFAULT '{}'::jsonb,
    scope       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- 组织标签 ID 数组；空 = 全员
    open_at     timestamptz NULL,
    close_at    timestamptz NULL,
    created_at  timestamptzz NOT NULL DEFAULT now(),
    created_by  bigint NULL,
    updated_at  timestamptz NULL,
    deleted_at  timestamptz NULL
);
```

---

## 7. Grading Schema

### 7.1 `grading.score_result`

```sql
CREATE TABLE grading.score_result (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    attempt_id    bigint NOT NULL REFERENCES delivery.attempt(id) ON DELETE CASCADE,
    question_id   bigint NOT NULL REFERENCES catalog.question(id),
    paper_item_id bigint NULL,
    score         numeric(6,2) NOT NULL,
    max_score     numeric(6,2) NOT NULL,
    method        text NOT NULL CHECK (method IN ('auto_scored','auto_suggested','manual_scored')),
    status        text NOT NULL CHECK (status IN ('pending','auto_scored','suggested','final')),
    detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
    scored_by     bigint NULL,
    scored_at     timestamptz NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NULL
);
CREATE UNIQUE INDEX uq_score_result_attempt_question ON grading.score_result(attempt_id, question_id);
CREATE INDEX ix_score_result_attempt ON grading.score_result(attempt_id);
```

### 7.2 `grading.review_task`

```sql
CREATE TABLE grading.review_task (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    attempt_id      bigint NOT NULL REFERENCES delivery.attempt(id) ON DELETE CASCADE,
    exam_session_id bigint NULL REFERENCES delivery.exam_session(id),
    question_id     bigint NOT NULL REFERENCES catalog.question(id),
    step_code       text NULL,          -- 综合题按步骤拆分
    answer_text     text NOT NULL,
    suggested_score numeric(6,2) NULL,
    max_score       numeric(6,2) NOT NULL,
    status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_review','reviewed')),
    assignee_id     bigint NULL,
    reviewer_id     bigint NULL,
    final_score     numeric(6,2) NULL,
    comment         text NULL,
    reviewed_at     timestamptz NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NULL
);
CREATE INDEX ix_review_task_status ON grading.review_task(status, created_at);
CREATE INDEX ix_review_task_attempt ON grading.review_task(attempt_id);
CREATE INDEX ix_review_task_exam ON grading.review_task(exam_session_id, status);
```

### 7.3 `grading.grade_publication` / `app.grade_revision`

```sql
CREATE TABLE grading.grade_publication (
    id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    exam_session_id      bigint NOT NULL REFERENCES delivery.exam_session(id),
    scope                text NOT NULL CHECK (scope IN ('all','objective_only')),
    included_attempt_ids bigint[] NOT NULL DEFAULT '{}',
    published_at         timestamptz NOT NULL DEFAULT now(),
    published_by         bigint NOT NULL
);
CREATE INDEX ix_grade_publication_session ON grading.grade_publication(exam_session_id);

CREATE TABLE app.grade_revision (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    score_result_id bigint NOT NULL,
    previous_score numeric(6,2) NULL,
    new_score      numeric(6,2) NOT NULL,
    comment        text NULL,
    operator_id    bigint NOT NULL,
    occurred_at    timestamptz NOT NULL DEFAULT now()
);
```

---

## 8. Learning 与 Analytics Schema

```sql
CREATE TABLE learning.mistake (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id        bigint NOT NULL REFERENCES iam.user(id),
    question_id    bigint NOT NULL REFERENCES catalog.question(id),
    wrong_count    integer NOT NULL DEFAULT 1,
    reason         text NOT NULL,
    source_type    text NOT NULL CHECK (source_type IN ('exam','practice')),
    source_attempt_id bigint NULL,
    last_wrong_at  timestamptz NOT NULL DEFAULT now(),
    resolved_at    timestamptz NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NULL,
    deleted_at     timestamptz NULL
);
CREATE UNIQUE INDEX uq_mistake_user_question ON learning.mistake(user_id, question_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_mistake_user_wrong ON learning.mistake(user_id, wrong_count DESC);

CREATE TABLE learning.ability_profile (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         bigint NOT NULL REFERENCES iam.user(id),
    ability_tag_id  bigint NOT NULL REFERENCES catalog.tag(id),
    mastery_rate    numeric(6,4) NOT NULL DEFAULT 0,
    sample_size     integer NOT NULL DEFAULT 0,
    correct_count   integer NOT NULL DEFAULT 0,
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_ability_profile ON learning.ability_profile(user_id, ability_tag_id);

CREATE TABLE learning.practice_result (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id          bigint NOT NULL REFERENCES iam.user(id),
    practice_assignment_id bigint NOT NULL REFERENCES learning.practice_assignment(id),
    attempt_id       bigint NOT NULL REFERENCES delivery.attempt(id),
    attempt_no       integer NOT NULL,
    score            numeric(8,2) NOT NULL,
    total_score      numeric(8,2) NOT NULL,
    duration_seconds integer NULL,
    submitted_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_practice_result_user ON learning.practice_result(user_id, submitted_at DESC);

-- Analytics 读模型
CREATE TABLE analytics.exam_statistic (
    exam_session_id bigint NOT NULL REFERENCES delivery.exam_session(id),
    participant_count integer NOT NULL DEFAULT 0,
    submitted_count  integer NOT NULL DEFAULT 0,
    absent_count     integer NOT NULL DEFAULT 0,
    average_score    numeric(8,2) NULL,
    max_score        numeric(8,2) NULL,
    min_score        numeric(8,2) NULL,
    pass_rate        numeric(6,4) NULL,
    excellent_rate   numeric(6,4) NULL,
    score_buckets    jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (exam_session_id)
);

CREATE TABLE analytics.question_statistic (
    exam_session_id bigint NOT NULL REFERENCES delivery.exam_session(id),
    question_id     bigint NOT NULL,
    answered_count  integer NOT NULL DEFAULT 0,
    correct_count   integer NOT NULL DEFAULT 0,
    average_score   numeric(8,2) NULL,
    mastery_rate    numeric(6,4) NULL,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (exam_session_id, question_id)
);

CREATE TABLE analytics.type_statistic (
    exam_session_id bigint NOT NULL REFERENCES delivery.exam_session(id),
    question_type   text NOT NULL,
    answered_count  integer NOT NULL DEFAULT 0,
    average_score   numeric(8,2) NULL,
    score_rate      numeric(6,4) NULL,
    PRIMARY KEY (exam_session_id, question_type)
);
```

---

## 9. Audit 与 Outbox Schema

```sql
CREATE TABLE audit.audit_log (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operator_id    bigint NULL,
    operator_name  text NULL,
    action         text NOT NULL,
    target_type    text NULL,
    target_id      text NULL,
    summary        jsonb NOT NULL DEFAULT '{}'::jsonb,
    ip             inet NULL,
    user_agent     text NULL,
    request_id     text NULL,
    occurred_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_time ON audit.audit_log(occurred_at DESC);
CREATE INDEX ix_audit_operator ON audit.audit_log(operator_id, occurred_at DESC);
CREATE INDEX ix_audit_target ON audit.audit_log(target_type, target_id);
-- 权限
REVOKE UPDATE, DELETE ON ALL TABLES IN SCHEMA audit FROM exam_app;

CREATE TABLE outbox.outbox_message (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    message_type   text NOT NULL,
    payload        jsonb NOT NULL,
    occurred_at    timestamptz NOT NULL DEFAULT now(),
    dispatched_at  timestamptz NULL,
    attempts       integer NOT NULL DEFAULT 0,
    last_error     text NULL
);
CREATE INDEX ix_outbox_pending ON outbox.outbox_message(dispatched_at) WHERE dispatched_at IS NULL;
```

---

## 10. 分区与归档

### 10.1 分区表

| 表 | 分区键 | 周期 | 保留 |
|---|---|---|---|
| `app.answer_revision` | `server_received_at` | 月 | 在线 12 个月，冷分区转只读 |
| `app.focus_event` | `server_received_at` | 月 | 在线 12 个月 |
| `audit.audit_log` | `occurred_at` | 月 | 在线 24 个月 |
| `delivery.answer` | `saved_at` | 月 | 在线 24 个月 |

分区由 `Exam.Worker` 的 `PartitionMaintenanceJob` 提前 1 个月预建；过期分区 `DETACH` 后导出归档。

### 10.2 归档

- 12 个月前的 `app.*` 分区 `DETACH` 并转为只读表，导出到归档库。
- 24 个月前的作答主表与成绩数据归档，保留可查询视图。
- 归档数据加密存储。

---

## 11. 数据库账号与权限

| 账号 | 用途 | 权限 |
|---|---|---|
| `exam_owner` | 表结构所有者，执行迁移 | 全部权限，**仅迁移作业使用** |
| `exam_app` | 应用运行时 | `iam/catalog/authoring/delivery/grading/learning/analytics/outbox` 读写；`app/audit` 仅 `SELECT, INSERT` |
| `exam_readonly` | 报表/BI | 全库 `SELECT` |
| `exam_backup` | 备份 | 全部 `SELECT` + 序列使用权限 |

```sql
REVOKE UPDATE, DELETE ON ALL TABLES IN SCHEMA app, audit FROM exam_app;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA app, audit TO exam_app;
```

---

## 12. 迁移策略

1. 所有变更通过 `dotnet ef migrations add` 生成，迁移脚本入库（`backend/src/Exam.Infrastructure/Persistence/Migrations/`）。
2. 迁移在部署时由独立的一次性容器执行（连接串用 `exam_owner`），应用容器不自动迁移。
3. 迁移必须满足：**在空库上一次跑通**（CI 用全新容器验证）。
4. 破坏性变更（删列、改类型）分两步：先双写/兼容读，发布后再清理。
5. 大表加列使用 `IF NOT EXISTS` + 可空 + 默认值分批回填，避免长锁。

---

## 13. 种子数据

系统首次启动时由幂等种子作业写入（带 `SeedMarker` 表避免重复执行）：

| 类别 | 内容 |
|---|---|
| 权限 | 全部权限码（约 40 条） |
| 角色 | 5 个系统角色及其默认权限映射 |
| 组织维度标签 | 学院 → 专业 → 班级 的标签树（示例） |
| 用户 | 1 个系统管理员、2 个教师、若干在校学生、若干社会人士 |
| 标签 | 五维标签体系：5 个领域、21 个知识点、6 个能力、3 个难度（`基础/中等/较难`）、组织维度标签树 |
| 题目 | 35 道示例题（沿用原型的 `seed.js` 数据结构，转换为数据库行） |

原型 `seed.js` 中的 3 个悬空标签 id（`t-dom-math` / `t-pt-calc` / `t-pt-tree`）在种子时**补齐定义**（D6 修正）。
