import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { PriceTag } from "@/components/store/PriceTag";

afterEach(cleanup);

test("strikes regularPrice and shows Save badge even without an active sale", () => {
  const { container } = render(<PriceTag price={850} regularPrice={1200} sale={null} />);
  expect(container.querySelector(".price-now")?.textContent).toBe("৳ 850");
  expect(container.querySelector("s.price-was")?.textContent).toContain("৳ 1,200");
  expect(screen.getByText("Save ৳ 350")).toBeTruthy();
});

test("strikes regularPrice and shows Save badge during an active sale", () => {
  const { container } = render(<PriceTag price={900} regularPrice={1000} sale={{ badge: "10% off" }} />);
  expect(container.querySelector(".price-now")?.textContent).toBe("৳ 900");
  expect(container.querySelector("s.price-was")?.textContent).toContain("৳ 1,000");
  expect(screen.getByText("Save ৳ 100")).toBeTruthy();
});

test("renders plain price when regularPrice is null or not above price", () => {
  const { container, rerender } = render(<PriceTag price={850} regularPrice={null} sale={null} />);
  expect(container.querySelector(".price-value")?.textContent).toBe("৳ 850");
  expect(container.querySelector(".price-save")).toBeNull();

  rerender(<PriceTag price={850} regularPrice={850} sale={null} />);
  expect(container.querySelector(".price-value")?.textContent).toBe("৳ 850");
  expect(container.querySelector(".price-save")).toBeNull();
});
