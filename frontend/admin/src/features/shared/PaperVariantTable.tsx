/* ==========================================================================
   知行测评 · 管理端卷面预览表（服务端卷面）
   --------------------------------------------------------------------------
   服务端的派生卷面就是答题者真正拿到的那一份：题序与选项的**显示顺序**
   都在服务端算好（选项带的是原题键，顺序是置换后的）。

   mock 模式的预览走引擎的 `buildPaper`（`PaperPreviewTable`）；
   HTTP 模式的预览走这里——两边看到的都是「答题者所见」。
   ========================================================================== */

import type { PaperVariant } from "@exam/shared/api";
import { LETTERS, TYPE_LABEL } from "@exam/shared/engine/paper";
import { TypeBadge } from "./bits";

export interface PaperVariantTableProps {
  /** 服务端给的派生卷面。 */
  variant: PaperVariant;
}

/** 卷面预览表（服务端卷面）。 */
export function PaperVariantTable({ variant }: PaperVariantTableProps) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">题号</th>
            <th scope="col">题目内容（答题者所见）</th>
          </tr>
        </thead>
        <tbody>
          {variant.items.map((item, index) => {
            const objective =
              item.type === "single" || item.type === "multi" || item.type === "judge";
            return (
              <tr key={item.questionId}>
                <td className="num">{index + 1}</td>
                <td>
                  <div className="strong" style={{ fontWeight: 500 }}>
                    {item.stem}
                  </div>
                  <div className="row-tight" style={{ marginTop: "var(--sp-2)" }}>
                    <TypeBadge type={item.type} />
                    <span className="text-xs text-3 mono">{item.questionCode}</span>
                  </div>
                  {objective ? (
                    <div className="q-opts" style={{ gap: "var(--sp-2)" }}>
                      {item.options.map((option, position) => {
                        const letter = LETTERS[position] ?? option.key;
                        return (
                          <div className="opt" key={`${option.key}-${position}`}>
                            <span className="opt-key" aria-hidden="true">
                              {letter}
                            </span>
                            <span className="opt-text">{option.text}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-sm text-3">
                      主观题 · {item.typeLabel || TYPE_LABEL[item.type as keyof typeof TYPE_LABEL]} ·{" "}
                      {item.score} 分
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
