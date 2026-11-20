/* ==========================================================================
   知行测评 · 学生端错题本
   --------------------------------------------------------------------------
   对应原型 student.mistakes：错题列表 + 单题重做。
   筛选（标签 / 题型 / 时间范围 / 是否含已掌握）对应 FR-LRN-01 的验收。
   ========================================================================== */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Card,
  Empty,
  Field,
  PageHead,
  Segmented,
  SelectInput,
  TagFilter,
} from "@exam/shared";
import type { MistakeFilter } from "@exam/shared/api";
import { TYPE_LABEL } from "@exam/shared/engine/paper";
import { useCatalog } from "@exam/shared/mock/catalog";
import { TagChips } from "@/features/shared/TagChips";
import { useMistakeList, useRedoMistake } from "./useMistakeList";

/** 时间范围预设（天）。 */
const TIME_RANGES = [
  { value: "7", label: "最近 7 天" },
  { value: "30", label: "最近 30 天" },
  { value: "90", label: "最近 90 天" },
];

/** 错题本。 */
export function MistakesPage() {
  const navigate = useNavigate();
  const tags = useCatalog((state) => state.tags);

  const [tagId, setTagId] = useState("");
  const [questionType, setQuestionType] = useState("");
  const [rangeDays, setRangeDays] = useState("");
  const [includeResolved, setIncludeResolved] = useState(false);

  // 筛选条件要稳定：数据通路按它决定要不要重新取数。
  const filter = useMemo<MistakeFilter>(
    () => ({
      ...(tagId ? { tagId } : {}),
      ...(questionType ? { questionType } : {}),
      ...(rangeDays
        ? { from: new Date(Date.now() - Number(rangeDays) * 86400000).toISOString() }
        : {}),
      ...(includeResolved ? { includeResolved: true } : {}),
    }),
    [tagId, questionType, rangeDays, includeResolved],
  );

  const { rows: mistakes } = useMistakeList(filter);
  const redo = useRedoMistake();

  const groups = useMemo(() => {
    const order = [
      { group: "domain", label: "领域" },
      { group: "knowledge_point", label: "知识点" },
      { group: "ability", label: "能力" },
      { group: "difficulty", label: "难度" },
    ] as const;
    return order.map((item) => ({
      ...item,
      tags: tags
        .filter((t) => t.group === item.group)
        .map((t) => ({ id: t.id, name: t.name, group: t.group })),
    }));
  }, [tags]);

  // 服务端一次只接一个标签，所以这里只保留最后点中的那个。
  const toggleTag = (id: string) => setTagId((prev) => (prev === id ? "" : id));

  const filtering = Boolean(tagId || questionType || rangeDays || includeResolved);

  return (
    <>
      <PageHead
        title="错题本"
        sub="做错的题目自动收录，可按标签、题型与时间筛选，也可单题重做；重做后可查看要点命中情况。"
      />

      <Card>
        <div className="row" style={{ marginBottom: "var(--sp-3)" }}>
          <Field label="题型" htmlFor="mistake-type">
            <SelectInput
              id="mistake-type"
              value={questionType}
              onChange={(event) => setQuestionType(event.target.value)}
            >
              <option value="">全部题型</option>
              {Object.entries(TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectInput>
          </Field>

          <Field label="时间范围" htmlFor="mistake-range">
            <SelectInput
              id="mistake-range"
              value={rangeDays}
              onChange={(event) => setRangeDays(event.target.value)}
            >
              <option value="">全部时间</option>
              {TIME_RANGES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </SelectInput>
          </Field>

          <Segmented
            label="已掌握"
            value={includeResolved ? "yes" : "no"}
            onChange={(value) => setIncludeResolved(value === "yes")}
            options={[
              { value: "no", label: "只看未掌握" },
              { value: "yes", label: "含已掌握" },
            ]}
          />
        </div>

        <TagFilter
          groups={groups}
          selected={tagId ? [tagId] : []}
          onToggle={toggleTag}
        />
      </Card>

      <section className="card" style={{ marginTop: "var(--sp-4)" }}>
        <div className="card-body is-flush">
          {mistakes.length === 0 ? (
            filtering ? (
              <Empty title="没有匹配的错题" body="换一个标签、题型或时间范围后再试一次。" />
            ) : (
              <Empty
                title="错题本是空的"
                body="完成练习后，答错的题目会自动出现在这里。"
                action={
                  <Button size="sm" onClick={() => navigate("/practice")}>
                    去练习
                  </Button>
                }
              />
            )
          ) : (
            mistakes.map((mistake) => (
              <div
                className="list-row"
                key={mistake.questionId}
                style={{ gridTemplateColumns: "minmax(0,1fr) 96px 120px 96px" }}
              >
                <div className="list-main">
                  <div className="list-title">{mistake.stem}</div>
                  <div className="list-sub">
                    {TYPE_LABEL[mistake.type] ?? mistake.typeLabel}
                  </div>
                  <div className="row-tight">
                    <TagChips tags={mistake.tags} />
                  </div>
                  <div className="list-sub">错因：{mistake.reason}</div>
                </div>
                <div className="text-sm text-3">错 {mistake.wrongCount} 次</div>
                <div className="text-sm text-3">{mistake.lastWrongAt}</div>
                <div className="right">
                  <Button size="sm" onClick={() => redo(mistake.questionId)}>
                    重做
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}
