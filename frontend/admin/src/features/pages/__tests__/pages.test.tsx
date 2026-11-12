import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { OverviewPage } from "../../pages";

function renderWithRouter(node: ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe("管理端概览页", () => {
  it("渲染标题与统计卡片", () => {
    renderWithRouter(<OverviewPage />);
    expect(screen.getByRole("heading", { name: "概览" })).toBeInTheDocument();
    expect(screen.getByText("题库")).toBeInTheDocument();
    expect(screen.getByText("待阅卷")).toBeInTheDocument();
  });

  it("提示尚未接入后端", () => {
    renderWithRouter(<OverviewPage />);
    expect(screen.getByText("尚未接入后端")).toBeInTheDocument();
  });
});
