/* ==========================================================================
   知行测评 · 管理端卷面预览表
   --------------------------------------------------------------------------
   原型 admin.js 的 paperRowsHtml：展示答题者实际看到的题序与选项顺序。
   这里的「答题者所见」来自引擎的 buildPaper，displayKeys 即显示顺序的原题选项键。
   ========================================================================== */

import type { BuiltPaper } from "@exam/shared/engine/paper";
import { LETTERS, TYPE_LABEL } from "@exam/shared/engine/paper";
import { DifficultyChip, TagChips, TypeBadge } from "./bits";

export interface PaperPreviewTableProps {
  /** 引擎构建的卷面。 */
  paper: BuiltPaper;
  /** 是否显示「标准题号」列（大梅花卷需要对照基础题序）。 */
  showBase?: boolean;
}

/** 卷面预览表。 */
export function PaperPreviewTable({ paper, showBase = false }: PaperPreviewTableProps) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">题号</th>
            {showBase ? <th scope="col">标准题号</th> : null}
            <th scope="col">题目内容（答题者所见）</th>
          </tr>
        </thead>
        <tbody>
          {paper.items.map((item) => {
            const q = item.question;
            const objective = q.type === "single" || q.type === "multi" || q.type === "judge";
            return (
              <tr key={item.qid}>
                <td className="num">{item.slot}</td>
                {showBase ? <td className="text-xs mono">第 {item.originalIndex} 题</td> : null}
                <td>
                  <div className="strong" style={{ fontWeight: 500 }}>
                    {q.stem}
                  </div>
                  <div className="row-tight" style={{ marginTop: "var(--sp-2)" }}>
                    <TypeBadge type={q.type} />
                    <DifficultyChip tags={q.tags} />
                    <TagChips tags={q.tags} limit={3} />
                    {item.changed ? <span className="variant-tag is-diff">选项已置换</span> : null}
                  </div>
                  {objective ? (
                    <div className="q-opts" style={{ gap: "var(--sp-2)" }}>
                      {item.displayKeys.map((originalKey, position) => {
                        const letter = LETTERS[position] ?? originalKey;
                        const opt = (q.options ?? []).find((o) => o.key === originalKey);
                        const isAnswer = q.answer.includes(originalKey);
                        return (
                          <div className={`opt${isAnswer ? " is-correct" : ""}`} key={originalKey}>
                            <span className="opt-key" aria-hidden="true">
                              {letter}
                            </span>
                            <span className="opt-text">{opt?.text ?? ""}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-sm text-3">
                      主观题 · {TYPE_LABEL[q.type]} · {item.score} 分
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
