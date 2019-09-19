import * as t from "@babel/types";
import { typeAnnotationToTSType } from "./ts-type-converters";
import { BaseNodeDefaultSpreadTypes } from "./structs";

type InlineConverter = (typeAnnotation: t.TSType | t.TSTypeReference) => t.Node;
type ShouldNotInlineValue = null;
type UtilityTypeMapping = {
  [key: string]: InlineConverter | ShouldNotInlineValue;
};

const inlineableTypes: UtilityTypeMapping = {
  $Keys: (typeAnnotation): t.TSTypeOperator => ({
    // TODO: patch @babel/types - tsTypeOperator should accept two arguments
    // return t.tsTypeOperator(typeAnnotation, "keyof");
    type: "TSTypeOperator",
    typeAnnotation,
    operator: "keyof",
    ...BaseNodeDefaultSpreadTypes
  }),

  $Values: typeAnnotation => {
    return t.tsIndexedAccessType(
      typeAnnotation,
      // TODO: patch @babel/types - tsTypeOperator should accept two arguments
      //t.tsTypeOperator(typeAnnotation, "keyof"),
      {
        type: "TSTypeOperator",
        typeAnnotation,
        operator: "keyof",
        ...BaseNodeDefaultSpreadTypes
      }
    );
  },

  $ReadOnly: typeAnnotation => {
    const typeName = t.identifier("Readonly");
    const typeParameters = t.tsTypeParameterInstantiation([typeAnnotation]);
    return t.tsTypeReference(typeName, typeParameters);
  },

  $Shape: typeAnnotation => {
    const typeName = t.identifier("Partial");
    const typeParameters = t.tsTypeParameterInstantiation([typeAnnotation]);
    return t.tsTypeReference(typeName, typeParameters);
  },

  $NonMaybeType: typeAnnotation => {
    const typeName = t.identifier("NonNullable");
    const typeParameters = t.tsTypeParameterInstantiation([typeAnnotation]);
    return t.tsTypeReference(typeName, typeParameters);
  },

  $ReadOnlyArray: typeAnnotation => {
    const typeName = t.identifier("ReadonlyArray");
    const typeParameters = t.tsTypeParameterInstantiation([typeAnnotation]);
    return t.tsTypeReference(typeName, typeParameters);
  }
};

const removalTypes: UtilityTypeMapping = {
  $Subtype: typeAnnotation => typeAnnotation,
  $Supertype: typeAnnotation => typeAnnotation
};

const alwaysImportedTypes: { [key: string]: null } = {
  Class: null, // TODO

  // These are two complicate to inline so we'll leave them as imports
  $Diff: null,
  $PropertyType: null,
  $ElementType: null,
  $Call: null
};

// TODO: figure out how to template these inline definitions
export const transformers: UtilityTypeMapping = {
  ...inlineableTypes,
  ...removalTypes,
  ...alwaysImportedTypes
};

export const alwaysInlinedTypes: (keyof typeof transformers)[] = [
  "$ReadOnlyArray",

  // These types are REMOVED
  "$Subtype",
  "$Supertype"
];
