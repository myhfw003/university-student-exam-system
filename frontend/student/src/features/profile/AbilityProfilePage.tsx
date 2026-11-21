/* ==========================================================================
   知行测评 · 学生端能力画像
   --------------------------------------------------------------------------
   对应 FR-LRN-02：按「能力」维度的标签聚合学生表现，给出掌握度（0..1）
   与样本量；样本量不足时明确标注「样本不足」。

   版式沿用原型的个人中心（卡片 + 横条 + 表格）：
     - 统计条：能力标签数 / 参与排序 / 样本不足；
     - 能力掌握度：一条能力一行（名称 · 分档 · 掌握度横条 · 百分数 · 样本量）；
     - 画像明细表：逐项的掌握度、样本量、全对数与分档。

   **口径全在服务端**：掌握度、样本量、分档与排序都是 `GET /abilities/profile`
   给的，前端不重算、不重排——服务端把样本不足的排在后面并标注出来，
   页面照它说的显示。
   ========================================================================== */

import { useNavigate } from "react-router-dom";
import { Badge, Button, Card, Empty, PageHead, Skeleton, Stat, type BadgeTone } from "@exam/shared";
import { formatPercentWithSign } from "@exam/shared";
import { MASTERY_LABEL, type MasteryLabel } from "@exam/shared/domain/ability";
import { useAbilityProfile } from "./useAbilityProfile";

/**
 * 分档 → 徽标色调。
 *
 * 分档文案由服务端给（`masteryLabel`），这里只决定颜色：
 * 掌握是达成、熟悉是进行中、薄弱是需要补的、样本不足是**还不能下结论**
 * （数据不够，不是表现差）——所以它用中性色，不用警告色。
 *
 * 词表与后端的一致性由 `scripts/check-ability-mastery-labels.py` 守着；
 * 认不出的分档按中性显示（文案照抄服务端给的）。
 */
const MASTERY_TONE: Record<MasteryLabel, BadgeTone> = {
  [MASTERY_LABEL.mastered]: "ok",
  [MASTERY_LABEL.familiar]: "primary",
  [MASTERY_LABEL.weak]: "warn",
  [MASTERY_LABEL.insufficient]: "neutral",
};

/** 取分档的色调；认不出的分档按中性显示。 */
function toneOf(label: string): BadgeTone {
  return MASTERY_TONE[label as MasteryLabel] ?? "neutral";
}

/** 能力画像。 */
export function AbilityProfilePage() {
  const navigate = useNavigate();
  const { profile, loading } = useAbilityProfile();

  const items = profile?.items ?? [];
  const total = profile?.total ?? 0;
  const insufficient = profile?.insufficientCount ?? 0;

  return (
    <>
      <PageHead
        title="能力画像"
        sub="按能力标签聚合的掌握情况：掌握度、样本量与分档。样本量不足的能力不参与排序。"
        actions={
          <Button onClick={() => navigate("/profile")}>
            返回个人中心
          </Button>
        }
      />

      <div className="stat-row">
        <Stat label="能力标签" value={total} unit="项" hint="参与统计的能力维度" />
        <Stat
          label="参与排序"
          value={total - insufficient}
          unit="项"
          hint="样本量够，排序看掌握度"
        />
        <Stat label="样本不足" value={insufficient} unit="项" hint="样本量不够，暂不下结论" />
      </div>

      <Card title="能力掌握度">
        {loading ? (
          <div className="stack-sm">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} height={18} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <Empty
            title="还没有能力画像"
            body="完成练习或考试并交卷定分后，这里会按能力标签汇总你的掌握情况。"
            action={
              <Button size="sm" onClick={() => navigate("/practice")}>
                去练习
              </Button>
            }
          />
        ) : (
          <>
            <div className="stack-sm">
              {items.map((item) => (
                <div
                  className="bar-row"
                  key={item.abilityTagId}
                  style={{ gridTemplateColumns: "minmax(0,1fr) 76px minmax(120px,1fr) 56px 72px" }}
                >
                  <span className="od-truncate">{item.tagName}</span>
                  <span>
                    <Badge tone={toneOf(item.masteryLabel)}>{item.masteryLabel}</Badge>
                  </span>
                  <span className="bar-track">
                    <span
                      className="bar-fill"
                      style={{ width: `${Math.round(item.masteryRate * 100)}%` }}
                    />
                  </span>
                  <span className="right num text-sm">
                    {formatPercentWithSign(item.masteryRate * 100)}
                  </span>
                  <span className="right num text-sm text-3">样本 {item.sampleSize}</span>
                </div>
              ))}
            </div>
            <p className="section-note" style={{ marginTop: "var(--sp-3)" }}>
              标「样本不足」的能力样本量不够，不参与排序——先多做几道题，结论才稳。
            </p>
          </>
        )}
      </Card>

      <Card title="画像明细">
        {items.length === 0 ? (
          <Empty title="暂无明细" body="定分之后这里会逐项列出掌握度与样本量。" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">能力标签</th>
                  <th className="right" scope="col">
                    掌握度
                  </th>
                  <th className="right" scope="col">
                    样本量
                  </th>
                  <th className="right" scope="col">
                    全对数
                  </th>
                  <th scope="col">分档</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.abilityTagId}>
                    <td>{item.tagName}</td>
                    <td className="num right">{formatPercentWithSign(item.masteryRate * 100)}</td>
                    <td className="num right">{item.sampleSize}</td>
                    <td className="num right">{item.correctCount}</td>
                    <td>
                      <Badge tone={toneOf(item.masteryLabel)}>{item.masteryLabel}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
