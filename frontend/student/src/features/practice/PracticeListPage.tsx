/* ==========================================================================
   知行测评 · 学生端练习中心
   --------------------------------------------------------------------------
   对应原型 student.practice：标签多选筛选 + 关键词搜索 + 卡片网格。
   ========================================================================== */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Empty, PageHead, SearchInput, TagChip, TagFilter } from "@exam/shared";
import { formatPercent } from "@exam/shared";
import { TYPE_LABEL } from "@exam/shared/engine/paper";
import { useCatalog } from "@exam/shared/mock/catalog";
import { useStudentRecords, useVisiblePractices } from "@/features/shared/studentData";

/** 练习中心。 */
export function PracticeListPage() {
  const navigate = useNavigate();
  const practices = useVisiblePractices();
  const records = useStudentRecords();
  const tags = useCatalog((state) => state.tags);
  const questions = useCatalog((state) => state.questions);

  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  /** 按分组组织标签，供筛选器使用。 */
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
    return practices.filter((practice) => {
      if (selected.length > 0 && !practice.tags.some((tagId) => selected.includes(tagId))) {
        return false;
      }
      if (!kw) return true;
      const tagNames = practice.tags
        .map((tagId) => tags.find((t) => t.id === tagId)?.name ?? "")
        .join(" ")
        .toLowerCase();
      return practice.name.toLowerCase().includes(kw) || tagNames.includes(kw);
    });
  }, [practices, keyword, selected, tags]);

  const toggleTag = (tagId: string) => {
    setSelected((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );
  };

  return (
    <>
      <PageHead
        title="练习中心"
        sub="以标签为组织轴的小规模练习：可同时勾选多个标签进行筛选，完成后立即给出解析与要点自评。"
      />

      <Card>
        <div className="row" style={{ marginBottom: "var(--sp-3)" }}>
          <div className="field od-fill">
            <label className="field-label" htmlFor="prac-search">
              搜索练习
            </label>
            <SearchInput
              id="prac-search"
              value={keyword}
              onSearch={setKeyword}
              placeholder="练习名称或标签"
              label="搜索练习"
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
          onClear={() => setSelected([])}
        />
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <Empty
            title="没有匹配的练习"
            body="换一个标签或清空筛选条件后再试一次。"
            action={
              <Button
                size="sm"
                onClick={() => {
                  setKeyword("");
                  setSelected([]);
                }}
              >
                查看全部练习
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid-3" style={{ marginTop: "var(--sp-5)" }}>
          {filtered.map((practice) => {
            const result = records.find((r) => r.kind === "practice" && r.id === practice.id);
            const types = practice.questionIds
              .map((qid) => questions.find((q) => q.id === qid)?.type)
              .filter((t): t is NonNullable<typeof t> => Boolean(t));
            const typeStats = Object.entries(
              types.reduce<Record<string, number>>((acc, t) => {
                acc[t] = (acc[t] ?? 0) + 1;
                return acc;
              }, {}),
            )
              .map(([type, count]) => `${TYPE_LABEL[type as keyof typeof TYPE_LABEL] ?? type} ${count}`)
              .join(" · ");

            const progress =
              result && result.total > 0
                ? Math.round((result.score / result.total) * 100)
                : 0;

            return (
              <Card key={practice.id}>
                <div className="row">
                  <div className="list-main">
                    <div className="list-title">{practice.name}</div>
                    <div className="list-sub">
                      {practice.questionIds.length} 题 · 约 {practice.durationMin} 分钟 · 总分{" "}
                      {practice.totalScore} 分
                    </div>
                    {typeStats ? <div className="list-sub">{typeStats}</div> : null}
                    <div className="row-tight">
                      {practice.tags.map((tagId) => (
                        <TagChip key={tagId} group="domain">
                          {tags.find((t) => t.id === tagId)?.name ?? tagId}
                        </TagChip>
                      ))}
                    </div>
                  </div>
                  <div className="spacer" />
                  <Button
                    variant="primary"
                    onClick={() => navigate(`/practice/${practice.id}`)}
                  >
                    {result ? "再练一次" : "开始练习"}
                  </Button>
                </div>

                <div className="meter" style={{ marginTop: "var(--sp-3)" }}>
                  <i style={{ width: `${progress}%` }} />
                </div>
                <div className="row text-sm text-3" style={{ marginTop: "var(--sp-2)" }}>
                  {result ? (
                    <>
                      <span>已完成 {result.score}/{result.total} 题</span>
                      <span>
                        正确率{" "}
                        {formatPercent(result.total > 0 ? (result.score / result.total) * 100 : 0)}%
                      </span>
                    </>
                  ) : (
                    <>
                      <span>尚未开始</span>
                      <span>预计用时 {practice.durationMin} 分钟</span>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
