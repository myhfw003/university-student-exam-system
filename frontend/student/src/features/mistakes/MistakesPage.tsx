/* ==========================================================================
   知行测评 · 学生端错题本
   --------------------------------------------------------------------------
   对应原型 student.mistakes：错题列表 + 单题重做。
   ========================================================================== */

import { useNavigate } from "react-router-dom";
import { Button, Empty, PageHead } from "@exam/shared";
import { TYPE_LABEL } from "@exam/shared/engine/paper";
import { TagChips } from "@/features/shared/TagChips";
import { useMistakeList, useRedoMistake } from "./useMistakeList";

/** 错题本。 */
export function MistakesPage() {
  const navigate = useNavigate();
  const { rows: mistakes } = useMistakeList();
  const redo = useRedoMistake();

  return (
    <>
      <PageHead
        title="错题本"
        sub="做错的题目自动收录，可单题重做；重做后可查看要点命中情况。"
      />

      <section className="card">
        <div className="card-body is-flush">
          {mistakes.length === 0 ? (
            <Empty
              title="错题本是空的"
              body="完成练习后，答错的题目会自动出现在这里。"
              action={
                <Button size="sm" onClick={() => navigate("/practice")}>
                  去练习
                </Button>
              }
            />
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
