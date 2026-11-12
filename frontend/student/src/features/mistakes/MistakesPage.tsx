/* ==========================================================================
   知行测评 · 学生端错题本
   --------------------------------------------------------------------------
   对应原型 student.mistakes：错题列表 + 单题重做。
   ========================================================================== */

import { useNavigate } from "react-router-dom";
import { Button, Empty, PageHead, TagChip } from "@exam/shared";
import { TYPE_LABEL } from "@exam/shared/engine/paper";
import { useCatalog } from "@exam/shared/mock/catalog";
import { useStudentMistakes } from "@/features/shared/studentData";

/** 错题本。 */
export function MistakesPage() {
  const navigate = useNavigate();
  const mistakes = useStudentMistakes();
  const questions = useCatalog((state) => state.questions);
  const tags = useCatalog((state) => state.tags);

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
            mistakes.map((mistake) => {
              const question = questions.find((q) => q.id === mistake.qid);
              if (!question) return null;
              return (
                <div
                  className="list-row"
                  key={`${mistake.qid}-${mistake.studentId}`}
                  style={{ gridTemplateColumns: "minmax(0,1fr) 96px 120px 96px" }}
                >
                  <div className="list-main">
                    <div className="list-title">{question.stem}</div>
                    <div className="list-sub">
                      {TYPE_LABEL[question.type] ?? question.type}
                    </div>
                    <div className="row-tight">
                      {question.tags.map((tagId) => (
                        <TagChip key={tagId} group="domain">
                          {tags.find((t) => t.id === tagId)?.name ?? tagId}
                        </TagChip>
                      ))}
                    </div>
                    <div className="list-sub">错因：{mistake.reason}</div>
                  </div>
                  <div className="text-sm text-3">错 {mistake.wrongCount} 次</div>
                  <div className="text-sm text-3">{mistake.lastWrongAt}</div>
                  <div className="right">
                    <Button
                      size="sm"
                      onClick={() => navigate(`/practice/single-${question.id}`)}
                    >
                      重做
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </>
  );
}
