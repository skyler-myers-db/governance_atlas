import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TopbarSearch } from "../TopbarSearch";

function renderSearch(overrides = {}) {
  const props = {
    searchRootRef: { current: null },
    searchQuery: "revenue",
    onSearchQueryChange: vi.fn(),
    searchPanelOpen: true,
    onSearchPanelOpenChange: vi.fn(),
    onSubmit: vi.fn(),
    shellDisabled: false,
    shellDisabledReason: "",
    searchEnabled: true,
    searchAssets: [],
    searchError: "",
    searchLoading: false,
    searchNotice: "",
    onSearchNoticeReset: vi.fn(),
    onSelectAsset: vi.fn(),
    topDirectResult: null,
    placeholder: "Search assets, columns, glossary terms, owners...",
    ...overrides,
  };
  render(<TopbarSearch {...props} />);
  return props;
}

describe("TopbarSearch", () => {
  it("clears the query and closes the search panel", () => {
    const props = renderSearch();

    fireEvent.click(screen.getByRole("button", { name: "Clear global search" }));

    expect(props.onSearchQueryChange).toHaveBeenCalledWith("");
    expect(props.onSearchNoticeReset).toHaveBeenCalled();
    expect(props.onSearchPanelOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders explicit loading and no-result rows in the dropdown", () => {
    const { rerender } = render(
      <TopbarSearch
        searchRootRef={{ current: null }}
        searchQuery="revenue"
        onSearchQueryChange={() => {}}
        searchPanelOpen
        onSearchPanelOpenChange={() => {}}
        onSubmit={() => {}}
        shellDisabled={false}
        shellDisabledReason=""
        searchEnabled
        searchAssets={[]}
        searchError=""
        searchLoading
        searchNotice=""
        onSearchNoticeReset={() => {}}
        onSelectAsset={() => {}}
        topDirectResult={null}
        placeholder="Search assets, columns, glossary terms, owners..."
      />,
    );

    expect(screen.getByText("Searching the current catalog scope...")).not.toBeNull();

    rerender(
      <TopbarSearch
        searchRootRef={{ current: null }}
        searchQuery="revenue"
        onSearchQueryChange={() => {}}
        searchPanelOpen
        onSearchPanelOpenChange={() => {}}
        onSubmit={() => {}}
        shellDisabled={false}
        shellDisabledReason=""
        searchEnabled
        searchAssets={[]}
        searchError=""
        searchLoading={false}
        searchNotice=""
        onSearchNoticeReset={() => {}}
        onSelectAsset={() => {}}
        topDirectResult={null}
        placeholder="Search assets, columns, glossary terms, owners..."
      />,
    );

    expect(
      screen.getByText("No direct asset matches yet. Press Enter to open the full discovery workspace."),
    ).not.toBeNull();
  });
});
