import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

afterEach(cleanup);

test("Button renders as a link and keeps its variant, size and look classes", () => {
  render(
    <Button size="sm" variant="outline" render={<a href="tel:0181" target="_blank" rel="noreferrer" />}>
      Call
    </Button>,
  );
  const link = screen.getByRole("link", { name: "Call" });
  expect(link.tagName).toBe("A");
  expect(link.getAttribute("href")).toBe("tel:0181");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("data-variant")).toBe("outline");
  expect(link.getAttribute("data-size")).toBe("sm");
  expect(link.className).toContain("h-7");
  expect(link.className).toContain("border-border");
});

test("a Select with a label, a two-part item and a placeholder reads and changes by keyboard", async () => {
  const user = userEvent.setup();
  const onValueChange = vi.fn();

  function Form() {
    const [status, setStatus] = useState("new");
    const [category, setCategory] = useState("");
    return (
      <form>
        <Label htmlFor="status">Status</Label>
        <Select
          value={status}
          onValueChange={(value) => {
            onValueChange(value);
            setStatus(value);
          }}
        >
          <SelectTrigger id="status" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new">{"New"} (current)</SelectItem>
            <SelectItem value="confirmed">Confirm</SelectItem>
          </SelectContent>
        </Select>
        <Label htmlFor="category">Category</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger id="category" className="w-full">
            <SelectValue placeholder="Pick a category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="bowls">Bowls</SelectItem>
          </SelectContent>
        </Select>
      </form>
    );
  }

  render(<Form />);
  const status = screen.getByRole("combobox", { name: "Status" });
  expect(status.textContent).toBe("New (current)");
  expect(status.getAttribute("data-slot")).toBe("select-trigger");
  expect(status.querySelector("[data-slot=select-value]")).toBeTruthy();
  expect(status.querySelectorAll("svg")).toHaveLength(1);

  const category = screen.getByRole("combobox", { name: "Category" });
  expect(category.textContent).toBe("Pick a category");
  expect(category.hasAttribute("data-placeholder")).toBe(true);

  status.focus();
  await user.keyboard("{Enter}");
  const list = await screen.findByRole("listbox");
  expect(list.getAttribute("data-slot")).toBe("select-content");
  const current = screen.getByRole("option", { name: "New (current)" });
  expect(current.getAttribute("aria-selected")).toBe("true");
  expect(current.textContent).toBe("New (current)");
  await user.keyboard("{ArrowDown}{Enter}");

  await waitFor(() => expect(status.textContent).toBe("Confirm"));
  expect(onValueChange).toHaveBeenCalledWith("confirmed");
  expect(document.activeElement).toBe(status);

  category.focus();
  await user.keyboard("{Enter}{Enter}");
  await waitFor(() => expect(category.textContent).toBe("Bowls"));
  expect(category.hasAttribute("data-placeholder")).toBe(false);
});

test("a Textarea named by its Label shows its value and reports typing", async () => {
  const user = userEvent.setup();
  const seen: string[] = [];

  function Note() {
    const [note, setNote] = useState("Called");
    return (
      <>
        <Label htmlFor="note">Note for the history</Label>
        <Textarea
          id="note"
          value={note}
          onChange={(event) => {
            seen.push(event.target.value);
            setNote(event.target.value);
          }}
        />
      </>
    );
  }

  render(<Note />);
  const note = screen.getByLabelText<HTMLTextAreaElement>("Note for the history");
  expect(note.value).toBe("Called");
  await user.type(note, "!");
  expect(note.value).toBe("Called!");
  expect(seen).toEqual(["Called!"]);
});
