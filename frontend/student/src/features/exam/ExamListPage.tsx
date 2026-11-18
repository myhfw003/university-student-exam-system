/* ==========================================================================
   知行测评 · 学生端考试安排
   --------------------------------------------------------------------------
   对应原型 student.exams：状态徽标矩阵 + 操作按钮 + 考试规则。

   数据来自 `useExamList`：mock 模式读本地内容仓库，HTTP 模式读后端场次，
   页面只认一种行（`ExamListRow`），不感知当前走的是哪条数据通路。
   ========================================================================== */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  Empty,
  PageHead,
  RuleList,
  SearchInput,
  TagFilter,
} from "@exam/shared";
import { useCatalog } from "@exam/shared/mock/catalog";
import { MULTI_POLICY } from "@exam/shared/engine/scoring";
import { TagChips } from "@/features/shared/TagChips";
import { useExamList, useRetakeExam, type ExamListRow } from "./useExamList";

/** 考试安排。 */
export function ExamListPage() {
  const navigate = useNavigate();
  const { rows } = useExamList();
  const retake = useRetakeExam();
  const tags = useCatalog((state) => state.tags);

  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const groups = useMemo(() => {
    const order: Array<{ group: "domain" | "knowledge_point" | "ability" | "difficulty"; label: string }> = [
      { group: "domain", label: "领域" },
      { group: "knowledge_point", label: "知识点" },
      { group: "ability", label: "能力" },
      { group: "difficulty", label: "难度" },
    ];
    return order.map((item) => ({
      ...item,
      tags: tags.filter((t) => t.group === item.group).map((t) => ({ id: t.id, name: t.name, group: t.group })),
    }));
  }, [tags]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter((row) => {
      if (selected.length > 0 && !row.tags.some((tagId) => selected.includes(tagId))) return false;
      if (!kw) return true;
      const tagNames = row.tags
        .map((tagId) => tags.find((t) => t.id === tagId)?.name ?? "")
        .join(" ")
        .toLowerCase();
      return (
        row.name.toLowerCase().includes(kw) ||
        row.subtitle.toLowerCase().includes(kw) ||
        tagNames.includes(kw)
      );
    });
  }, [rows, keyword, selected, tags]);

  const toggleTag = (tagId: string) => {
    setSelected((prev) => (prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]));
  };

  return (
    <>
      <PageHead
        title="考试安排"
        sub="试卷按卷型生成：标准卷全体答题者同一份卷面（题序按题型分块、组内由易到难）；小梅花题序统一、仅每位答题者的选项顺序打乱；大梅花保留题型分块顺序（单选→多选→判断→简答→综合），每个题型内部的题目顺序与选项顺序均为每位答题者独立打乱。"
      />

      <Card>
        <div className="row" style={{ marginBottom: "var(--sp-3)" }}>
          <div className="field od-fill">
            <label className="field-label" htmlFor="exam-search">
              搜索考试
            </label>
            <SearchInput
              id="exam-search"
              value={keyword}
              onSearch={setKeyword}
              placeholder="考试名称、批次或标签"
              label="搜索考试"
            />
          </div>
          <Button
            onClick={() => {
              setKeyword("");
              setSelected([]);
            }}
          >
            清空筛选
          </Button>
        </div>

        <TagFilter
          groups={groups}
          selected={selected}
          onToggle={toggleTag}
        />
      </Card>

      <section className="card" style={{ marginTop: "var(--sp-4)" }}>
        <div className="card-body is-flush">
          {filtered.length === 0 ? (
            <Empty title="没有匹配的考试" body="换一个标签或清空筛选条件后再试一次。" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">试卷</th>
                    <th scope="col">标签</th>
                    <th className="right" scope="col">时长</th>
                    <th className="right" scope="col">总分</th>
                    <th scope="col">卷型</th>
                    <th scope="col">开放时间</th>
                    <th scope="col">状态</th>
                    <th className="right" scope="col" aria-label="操作" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <ExamRow key={row.id} row={row} onRetake={retake} onNavigate={navigate} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="card" style={{ marginTop: "var(--sp-5)" }}>
        <div className="card-head">
          <h2 className="card-title">考试规则</h2>
        </div>
        <div className="card-body">
          <RuleList
            items={[
              "考试开始后计时，中途离开计时不中断；倒计时归零后系统自动交卷。",
              "客观题（单选、多选、判断）交卷后自动判分；主观题（简答、综合操作题）由管理端复核后计入成绩。",
              "可随时标记题目，交卷前可在答题卡中快速跳转检查。",
              MULTI_POLICY,
            ]}
          />
        </div>
      </section>
    </>
  );
}

/** 考试安排的一行：状态徽标与操作按钮按「已交卷 × 是否可重考 × 是否已结束」取值。 */
function ExamRow({
  row,
  onRetake,
  onNavigate,
}: {
  row: ExamListRow;
  onRetake: (row: ExamListRow) => void;
  onNavigate: (path: string) => void;
}) {
  let statusText: string;
  let tone: "ok" | "info" | "warn" | "neutral";
  if (row.submitted && !row.allowRetake) {
    statusText = "已交卷";
    tone = "ok";
  } else if (row.submitted && row.allowRetake) {
    statusText = "已交卷 · 可重考";
    tone = "info";
  } else if (!row.ended) {
    statusText = "进行中";
    tone = "warn";
  } else if (row.allowRetake) {
    statusText = "已结束 · 可补考";
    tone = "info";
  } else {
    statusText = "已结束";
    tone = "neutral";
  }

  return (
    <tr>
      <td>
        <div className="strong">{row.name}</div>
        <div className="text-xs text-3">{row.subtitle || "—"}</div>
      </td>
      <td>
        <TagChips tags={row.tags} />
      </td>
      <td className="num">{row.durationMin} 分钟</td>
      <td className="num">{row.totalScore > 0 ? `${row.totalScore} 分` : "—"}</td>
      <td>
        <span className="variant-tag">
          {row.mode === "standard" ? "标准卷" : row.mode === "small" ? "小梅花" : "大梅花"}
        </span>
      </td>
      <td className="text-3 text-sm">{row.openAt}</td>
      <td>
        <Badge tone={tone}>{statusText}</Badge>
      </td>
      <td className="col-actions">
        <div className="row-tight" style={{ justifyContent: "flex-end" }}>
          {row.submitted ? (
            <Button size="sm" onClick={() => onNavigate(`/exams/${row.id}/report`)}>
              查看报告
            </Button>
          ) : null}
          {row.submitted && row.allowRetake ? (
            <Button size="sm" onClick={() => onRetake(row)}>
              再考一次
            </Button>
          ) : null}
          {!row.submitted && !row.ended ? (
            <Button size="sm" variant="primary" onClick={() => onNavigate(`/exams/${row.id}`)}>
              进入考试
            </Button>
          ) : null}
          {!row.submitted && row.ended && row.allowRetake ? (
            <Button size="sm" variant="primary" onClick={() => onNavigate(`/exams/${row.id}`)}>
              进入考试
            </Button>
          ) : null}
          {!row.submitted && row.ended ? (
            <Button size="sm" onClick={() => onNavigate(`/exams/${row.id}/report`)}>
              回顾试卷
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
