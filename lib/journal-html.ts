// Server-side sanitization of journal body HTML. Runs at write (POST/PATCH),
// not at read, so public render stays fast and the stored body is already
// clean. Admin authors are trusted (Auth.js + admin role check) but defense
// in depth strips scripting and event handlers regardless.

import DOMPurify from 'isomorphic-dompurify';

export function sanitizeJournalHtml(input: string): string {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [
      'p', 'br', 'hr',
      'h2', 'h3', 'h4',
      'strong', 'em', 'b', 'i', 'u', 's', 'sub', 'sup', 'mark', 'small',
      'a',
      'ul', 'ol', 'li',
      'blockquote', 'cite',
      'code', 'pre',
      'figure', 'figcaption',
      'img',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'span', 'div',
    ],
    ALLOWED_ATTR: [
      'href', 'title', 'target', 'rel',
      'src', 'alt', 'width', 'height', 'loading',
      'class', 'id',
    ],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'style', 'link'],
    // Disallow data: and javascript: URIs in href/src.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|\/|#)/i,
  });
}
