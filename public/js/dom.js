/**
 * Safe DOM helpers. User content (answers, group names) is always inserted as text,
 * never as HTML (constitution principle II, spec.md AC-16). Do not use innerHTML with
 * data that came from the server or the user.
 */

/**
 * Creates an element. String children become text nodes.
 *
 * @param {string} tag
 * @param {Record<string, string | boolean | EventListener> | null} [attributes]
 *   `on<event>` keys add listeners; boolean values toggle the attribute.
 * @param {...(Node | string | number | null | undefined | false)} children
 */
export function h(tag, attributes = null, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes ?? {})) {
    if (name.startsWith('on') && typeof value === 'function') {
      element.addEventListener(name.slice(2).toLowerCase(), value);
    } else if (value === true) {
      element.setAttribute(name, '');
    } else if (value !== false && value != null) {
      element.setAttribute(name, String(value));
    }
  }
  append(element, ...children);
  return element;
}

/** Appends children; strings and numbers are added as text nodes. */
export function append(parent, ...children) {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/** Replaces all content of `element` with plain text. */
export function setText(element, text) {
  element.textContent = text ?? '';
  return element;
}

/** Removes all children. */
export function clear(element) {
  element.replaceChildren();
  return element;
}
