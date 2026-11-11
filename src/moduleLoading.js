export function moduleLoadMessage(error) {
  const message=String(error?.message||error||"");
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically imported module/i.test(message)
    ? "A website update or connection issue prevented part of the page from loading. Refresh the website, then choose the import file again. Saved marks and local drafts are kept."
    : message;
}
