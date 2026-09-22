import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { fixtureWorkspaceProvider } from "./resources/fixture-provider";

describe("workspace preview", () => {
  it("shows a useful error when a workspace cannot be loaded", async () => {
    const unavailableProvider = {
      getSnapshot: async () => { throw new Error("Folder is unavailable."); },
      readResource: async () => {},
      updateResource: async () => {},
      uploadResource: async () => {},
      setActiveSelection: async () => {},
    };
    render(<App provider={unavailableProvider} />);
    expect(await screen.findByText("Workspace unavailable")).toBeInTheDocument();
    expect(screen.getByText("Folder is unavailable.")).toBeInTheDocument();
  });

  it("activates context only after an explicit Ask action", async () => {
    const setActiveSelection = vi.fn((selection) => fixtureWorkspaceProvider.setActiveSelection(selection));
    render(<App provider={{ ...fixtureWorkspaceProvider, setActiveSelection }} />);
    const navigation = within(screen.getByRole("navigation", { name: "Workspace sections" }));
    fireEvent.click(navigation.getByRole("button", { name: /^Documents/ }));
    fireEvent.click(screen.getByRole("button", { name: /Base resume/ }));
    await screen.findByRole("heading", { name: "Maya Chen" });
    expect(setActiveSelection).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Ask about this" }));
    await waitFor(() => expect(setActiveSelection).toHaveBeenCalledWith(expect.objectContaining({ action: "review_resume" })));
    expect(await screen.findByText("Review resume: Base resume using CareerCoach.")).toBeInTheDocument();
  });

  it("copies the same visible request for an external host", async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<App />);
    const navigation = within(screen.getByRole("navigation", { name: "Workspace sections" }));
    fireEvent.click(navigation.getByRole("button", { name: /^Jobs/ }));
    fireEvent.click(within(screen.getByRole("table")).getAllByRole("button", { name: /Ask/ })[0]);
    await screen.findByText(/Review job:/);

    fireEvent.click(screen.getByRole("button", { name: /Antigravity/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^Review job: .* using CareerCoach\.$/)));
    expect(screen.getByRole("button", { name: /Copied/ })).toBeInTheDocument();
  });

  it("moves between each primary workspace section", () => {
    render(<App />);
    const navigation = within(screen.getByRole("navigation", { name: "Workspace sections" }));

    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();

    for (const section of ["Jobs", "Interview", "Documents", "Profile", "Skills"]) {
      fireEvent.click(navigation.getByRole("button", { name: new RegExp(`^${section}`) }));
      expect(screen.getByRole("heading", { name: section, level: 1 })).toBeInTheDocument();
    }
  });

  it("filters the jobs table by stage", () => {
    render(<App />);
    const navigation = within(screen.getByRole("navigation", { name: "Workspace sections" }));
    fireEvent.click(navigation.getByRole("button", { name: /^Jobs/ }));
    fireEvent.click(screen.getByRole("button", { name: "Hiring manager" }));

    const table = screen.getByRole("table");
    expect(within(table).getByText("Pioneer")).toBeInTheDocument();
    expect(within(table).queryByText("Acme")).not.toBeInTheDocument();
  });

  it("selects and edits a document through the fixture provider", async () => {
    render(<App />);
    const navigation = within(screen.getByRole("navigation", { name: "Workspace sections" }));
    fireEvent.click(navigation.getByRole("button", { name: /^Documents/ }));
    fireEvent.click(screen.getByRole("button", { name: /Base resume/ }));
    await screen.findByRole("heading", { name: "Maya Chen" });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const editor = screen.getByRole("textbox", { name: "Edit Base resume" });
    fireEvent.change(editor, { target: { value: "# Revised fixture resume" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Revised fixture resume" })).toBeInTheDocument());
  });

  it("searches across files and roles", () => {
    render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: "Find a file or role" }), {
      target: { value: "Acme" },
    });

    const results = screen.getByRole("dialog", { name: "Search results" });
    expect(within(results).getByText("Acme - tailored resume")).toBeInTheDocument();
    expect(within(results).getByText("Acme - VP Engineering, Applied AI")).toBeInTheDocument();
  });
});
