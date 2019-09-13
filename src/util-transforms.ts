import * as t from "@babel/types";

/**
 * Hides (and centralizes) the forced casting of Flow type annotations to TS type annotations.
 * In future, we should add a proper mapping of Flow to TS types.
 *
 * @param typeAnnotation (TypeAnnotation|TSTypeAnnotation)
 */
export const typeAnnotationToTSType = (
  typeAnnotation: t.TypeAnnotation | t.TSTypeAnnotation
): t.TSType =>
  t.isTSTypeAnnotation(typeAnnotation)
    ? typeAnnotation
    : (typeAnnotation as any);

/**
 * Hides (and centralizes) the forced casting of FlowType to TSType.
 * In future, we should add a proper mapping of Flow to TS types.
 *
 * @param type (FlowType|TSType)
 */
export const toTSType = (type: t.FlowType | t.TSType): t.TSType =>
  t.isTSType(type) ? type : (type as any);

/**
 * Hides (and centralizes) the forced casting of FlowType[] to TSType[].
 * In future, we should add a proper mapping of Flow to TS types.
 *
 * @param type (Array<FlowType|TSType>)
 */
export const toTSTypeArray = (type: (t.FlowType | t.TSType)[]): t.TSType[] =>
  type as any;

/**
 * Hides (and centralizes) the forced casting of TypeParameter[] to TSTypeParameter[].
 * In future, we should add a proper mapping of Flow to TS types.
 *
 * @param type (Array<TypeParameter|TSTypeParameter>)
 */
export const toTSTypeParameterArray = (
  type: t.TypeParameter[] | t.TSTypeParameter[]
): t.TSTypeParameter[] => type as any;

export const toTSEntityName = (
  type: t.Identifier | t.QualifiedTypeIdentifier
): t.TSEntityName => type as any;

export const toTSTypeParameterDeclaration = (
  type: t.TypeParameterDeclaration | t.TSTypeParameterDeclaration
): t.TSTypeParameterDeclaration =>
  t.isTSTypeParameterDeclaration(type)
    ? type
    : t.tsTypeParameterDeclaration(type.params as any);

export const toTSTypeParameterInstantiation = (
  type: t.TypeParameterInstantiation | t.TSTypeParameterInstantiation
): t.TSTypeParameterInstantiation =>
  t.isTSTypeParameterInstantiation(type)
    ? type
    : t.tsTypeParameterInstantiation(type.params as any);

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
