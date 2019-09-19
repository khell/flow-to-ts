import * as t from "@babel/types";

export type HasTypeAnnotation =
  | t.Identifier
  | t.RestElement
  | t.AssignmentPattern
  | t.ArrayPattern
  | t.ObjectPattern;

/**
 * Refines the type to only types with a typeAnnotation property.
 *
 * @param type
 */
export const hasTypeAnnotation = (type: t.LVal): type is HasTypeAnnotation =>
  t.isIdentifier(type) ||
  t.isRestElement(type) ||
  t.isAssignmentPattern(type) ||
  t.isArrayPattern(type) ||
  t.isObjectPattern(type);
