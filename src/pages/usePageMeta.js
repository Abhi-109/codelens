// Gives a page its own <title> and meta description (and puts the document
// back when you leave), so every route is identifiable in a tab, a bookmark
// and a search result.
//
// Restoring on cleanup matters: only some routes set a title, and a page
// that says nothing should get index.html's default back rather than inherit
// whatever the previous page left behind.

import { useEffect } from "react";

export function usePageMeta(title, description) {
  useEffect(() => {
    const meta = document.querySelector('meta[name="description"]');
    const previousTitle = document.title;
    const previousDescription = meta ? meta.getAttribute("content") : null;

    if (title) document.title = title;
    if (description && meta) meta.setAttribute("content", description);

    return () => {
      document.title = previousTitle;
      if (meta && previousDescription !== null) meta.setAttribute("content", previousDescription);
    };
  }, [title, description]);
}
