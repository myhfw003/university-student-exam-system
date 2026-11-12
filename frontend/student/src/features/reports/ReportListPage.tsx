/* ==========================================================================
   知行测评 · 学生端成绩报告列表
   --------------------------------------------------------------------------
   对应原型 student.reports：考试与练习成绩合并展示。
   ========================================================================== */

import { useNavigate } from "react-router-dom";
import { Badge, Button, Empty, PageHead } from "@exam/shared";
import { formatPercent } from "@exam/shared";
import { useStudentRecords } from "@/features/shared/studentData";

/** 成绩报告列表。 */
export function ReportListPage() {
  const navigate = useNavigate();
  const records = useStudentRecords();

  return (
    <>
      <PageHead
        title="成绩报告"
        sub="客观题自动判分，主观题需阅卷人复核后计入最终成绩。"
      />

      <section className="card">
        <div className="card-body is-flush">
          {records.length === 0 ? (
            <Empty
              title="暂无成绩记录"
              body="完成一次练习或考试后，成绩、得分率与逐题解析会汇总到这里。"
              action={
                <>
                  <Button size="sm" onClick={() => navigate("/practice")}>
                    去练习
                  </Button>
                  <Button size="sm" onClick={() => navigate("/exams")}>
                    看考试
                  </Button>
                </>
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>项目</th>
                    <th>日期</th>
                    <th className="right">得分</th>
                    <th className="right">得分率</th>
                    <th>状态</th>
                    <th className="right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => {
                    const rate =
                      record.total > 0 ? (record.score / record.total) * 100 : 0;
                    return (
                      <tr key={`${record.kind}-${record.id}`}>
                        <td>
                          <div className="strong">{record.name}</div>
                          <div className="text-xs text-3">
                            {record.kind === "exam" ? "考试" : "练习"}
                            {record.variantLabel ? ` · ${record.variantLabel}` : ""}
                          </div>
                        </td>
                        <td className="text-3">{record.date}</td>
                        <td className="num">
                          {record.score} / {record.total}
                        </td>
                        <td className="num">{formatPercent(rate)}%</td>
                        <td>
                          <Badge tone={record.pending ? "warn" : "ok"}>
                            {record.pending ? "待阅" : "已完成"}
                          </Badge>
                        </td>
                        <td className="col-actions">
                          <Button
                            size="sm"
                            onClick={() =>
                              navigate(
                                record.kind === "practice"
                                  ? `/practice/${record.id}`
                                  : `/exams/${record.id}/report`,
                              )
                            }
                          >
                            查看
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
