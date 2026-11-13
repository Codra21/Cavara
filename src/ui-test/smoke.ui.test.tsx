import { Button } from "@ui-sdk/react/button";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

test("renders a ui-sdk button with its label", () => {
  render(<Button>Save</Button>);
  expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
});
