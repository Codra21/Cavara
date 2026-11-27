import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { Checkbox } from "@/components/ui/checkbox";

afterEach(cleanup);

test("indeterminate Checkbox styles data-indeterminate and renders a minus icon instead of a checkmark", () => {
  render(<Checkbox aria-label="Select all" checked="indeterminate" onCheckedChange={() => {}} />);

  const box = screen.getByRole("checkbox", { name: "Select all" });
  expect(box.getAttribute("aria-checked")).toBe("mixed");
  expect(box.hasAttribute("data-indeterminate")).toBe(true);
  expect(box.className).toContain("data-indeterminate:bg-primary");
  expect(box.className).toContain("data-indeterminate:text-primary-foreground");

  const svg = box.querySelector("svg");
  expect(svg).toBeTruthy();
  expect(svg?.classList.contains("lucide-minus")).toBe(true);
  expect(svg?.classList.contains("lucide-check")).toBe(false);
});
