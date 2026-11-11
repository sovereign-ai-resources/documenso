import { BRAND_NAME, IS_BRANDED } from '../constants/brand';

// The upstream credit line must keep naming the project it is based on.
const PRODUCT_NAME = /Based on Documenso \(AGPL-3\.0\)|(?<![\w@/.])Documenso(?!\.[a-z])/g;

const CREDIT_PREFIX = 'Based on';

const replaceName = (text: string, name: string) =>
  text.replace(PRODUCT_NAME, (match) => (match.startsWith(CREDIT_PREFIX) ? match : name));

// Placeholder tokens may carry plural/select options (`[name, 'plural', { one: message }]`),
// whose values are messages themselves.
const mapMessage = (message: unknown, name: string): unknown => {
  if (typeof message === 'string') {
    return replaceName(message, name);
  }

  if (!Array.isArray(message)) {
    return message;
  }

  return message.map((part: unknown) => {
    if (typeof part === 'string') {
      return replaceName(part, name);
    }

    if (!Array.isArray(part)) {
      return part;
    }

    return part.map((item: unknown) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        return Object.fromEntries(Object.entries(item).map(([key, option]) => [key, mapMessage(option, name)]));
      }

      return item;
    });
  });
};

/**
 * Swap the product name for the brand name in a loaded message catalog.
 *
 * Handles both compiled forms: plain string messages, and arrays of text parts and
 * placeholder tokens. Placeholders are left as they are. An unbranded server gets the
 * catalog back untouched.
 */
export const applyBrandToMessages = <T extends Record<string, unknown>>(messages: T): T => {
  if (!IS_BRANDED()) {
    return messages;
  }

  const name = BRAND_NAME();

  return Object.fromEntries(Object.entries(messages).map(([id, message]) => [id, mapMessage(message, name)])) as T;
};
