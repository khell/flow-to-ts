import * as t from "@babel/types";
import { NodePath } from "@babel/core";
import { Visitor } from "@babel/traverse";

import { CliOptions } from "./cli";
import computeNewlines from "./compute-newlines";
import {
  typeAnnotationToTSType,
  toTSType,
  toTSTypeArray,
  toTSEntityName,
  toTSTypeParameterInstantiation,
  toTSTypeParameterDeclaration,
  hasTypeAnnotation
} from "./util-transforms";

export type VisitorState = {
  usedUtilityTypes: Set<string>;
  options: Partial<CliOptions>;
  comments: { [key: string]: t.File["comments"] };
  containsJSX: boolean;
  trailingLines: number;
};

type TodoAny = any;

const BaseNodeDefaultSpreadTypes = {
  leadingComments: null,
  innerComments: null,
  trailingComments: null,
  newlines: undefined,
  start: null,
  end: null,
  loc: null
};

const locToString = (loc: t.SourceLocation | null) =>
  loc
    ? `${loc.start.line}:${loc.start.column}-${loc.end.line}:${loc.end.column}`
    : "";

// TODO: figure out how to template these inline definitions
const utilityTypes = {
  $Keys: (
    typeAnnotation: t.TypeAnnotation | t.TSTypeAnnotation
  ): t.TSTypeOperator => ({
    // TODO: patch @babel/types - tsTypeOperator should accept two arguments
    // return t.tsTypeOperator(typeAnnotation, "keyof");
    type: "TSTypeOperator",
    typeAnnotation: typeAnnotationToTSType(typeAnnotation),
    operator: "keyof",
    ...BaseNodeDefaultSpreadTypes
  }),

  $Values: (typeAnnotation: t.TypeAnnotation | t.TSTypeAnnotation) => {
    const tsType = typeAnnotationToTSType(typeAnnotation);
    return t.tsIndexedAccessType(
      tsType,
      // TODO: patch @babel/types - tsTypeOperator should accept two arguments
      //t.tsTypeOperator(typeAnnotation, "keyof"),
      {
        type: "TSTypeOperator",
        typeAnnotation: tsType,
        operator: "keyof",
        ...BaseNodeDefaultSpreadTypes
      }
    );
  },

  $ReadOnly: (typeAnnotation: t.TypeAnnotation | t.TSTypeAnnotation) => {
    const typeName = t.identifier("Readonly");
    const typeParameters = t.tsTypeParameterInstantiation([
      typeAnnotationToTSType(typeAnnotation)
    ]);
    return t.tsTypeReference(typeName, typeParameters);
  },

  $Shape: (typeAnnotation: t.TypeAnnotation | t.TSTypeAnnotation) => {
    const typeName = t.identifier("Partial");
    const typeParameters = t.tsTypeParameterInstantiation([
      typeAnnotationToTSType(typeAnnotation)
    ]);
    return t.tsTypeReference(typeName, typeParameters);
  },

  $NonMaybeType: (typeAnnotation: t.TypeAnnotation | t.TSTypeAnnotation) => {
    const typeName = t.identifier("NonNullable");
    const typeParameters = t.tsTypeParameterInstantiation([
      typeAnnotationToTSType(typeAnnotation)
    ]);
    return t.tsTypeReference(typeName, typeParameters);
  },

  $ReadOnlyArray: (typeAnnotation: t.TypeAnnotation | t.TSTypeAnnotation) => {
    const typeName = t.identifier("ReadonlyArray");
    const typeParameters = t.tsTypeParameterInstantiation([
      typeAnnotationToTSType(typeAnnotation)
    ]);
    return t.tsTypeReference(typeName, typeParameters);
  },

  Class: null, // TODO

  // These are two complicate to inline so we'll leave them as imports
  $Diff: null,
  $PropertyType: null,
  $ElementType: null,
  $Call: null
};

const alwaysInlineUtilityTypes: (keyof typeof utilityTypes)[] = [
  "$ReadOnlyArray"
];

// Mapping between React types for Flow and those for TypeScript.
const UnqualifiedReactTypeNameMap = {
  SyntheticEvent: "SyntheticEvent",
  SyntheticAnimationEvent: "AnimationEvent",
  SyntheticClipboardEvent: "ClipboardEvent",
  SyntheticCompositionEvent: "CompositionEvent",
  SyntheticInputEvent: "InputEvent",
  SyntheticUIEvent: "UIEvent",
  SyntheticFocusEvent: "FocusEvent",
  SyntheticKeyboardEvent: "KeyboardEvent",
  SyntheticMouseEvent: "MouseEvent",
  SyntheticDragEvent: "DragEvent",
  SyntheticWheelEvent: "WheelEvent",
  SyntheticPointerEvent: "PointerEvent",
  SyntheticTouchEvent: "TouchEvent",
  SyntheticTransitionEvent: "TransitionEvent"
};

// Only types with different names are included.
const QualifiedReactTypeNameMap = {
  Node: "ReactNode",
  Text: "ReactText",
  Child: "ReactChild",
  Children: "ReactChildren",
  Element: "ReactElement",
  Fragment: "ReactFragment",
  Portal: "ReactPortal",
  NodeArray: "ReactNodeArray",

  // TODO: private types, e.g. React$ElementType, React$Node, etc.

  // TODO: handle ComponentType, ElementConfig, ElementProps, etc.
  ElementProps: "ComponentProps"
};

type ImportSpecifierReactTypeNameMapType = {
  [key: string]:
    | string
    | ((
        path: NodePath<t.ImportDeclaration>,
        specifier:
          | t.ImportSpecifier
          | t.ImportDefaultSpecifier
          | t.ImportNamespaceSpecifier
      ) => void);
};

const ImportSpecifierReactTypeNameMap: ImportSpecifierReactTypeNameMapType = {
  ...QualifiedReactTypeNameMap,
  ElementConfig: (path, specifier) => {
    // Implements this equivalent TS type:
    // type ElementConfig<C extends React.JSXElementConstructor<any>> = JSX.LibraryManagedAttributes<C, React.ComponentProps<C>>;
    const referencePaths = path.scope.bindings.ElementConfig.referencePaths;
    for (const referencePath of referencePaths) {
      const parentPath = referencePath.parentPath;
      const parentNode = parentPath.node;
      if (typeof (parentNode as any).typeParameters !== "undefined") {
        parentPath.replaceWith(
          t.tsTypeReference(
            t.tsQualifiedName(
              t.identifier("JSX"),
              t.identifier("LibraryManagedAttributes")
            ),
            t.tsTypeParameterInstantiation([
              t.tsTypeQuery(
                (parentNode as any).typeParameters.params[0].argument.id
              ),
              t.tsTypeReference(
                t.identifier("ComponentProps"),
                t.tsTypeParameterInstantiation([
                  t.tsTypeQuery(
                    (parentNode as any).typeParameters.params[0].argument.id
                  )
                ])
              )
            ])
          )
        );
      }
    }
    path.scope.rename("ElementConfig", "ComponentProps");
    if (specifier.type === "ImportSpecifier") {
      specifier.imported = specifier.local;
    }
  },

  ElementRef: (path, specifier) => {
    const referencePaths = path.scope.bindings.ElementRef.referencePaths;
    for (const referencePath of referencePaths) {
      const parentPath = referencePath.parentPath;
      const parentNode: any = parentPath.node;

      if (
        typeof parentNode.id !== undefined &&
        typeof parentNode.typeParameters !== "undefined"
      ) {
        parentPath.replaceWith(
          t.tsTypeReference(
            parentNode.id,
            t.tsTypeParameterInstantiation(
              parentNode.typeParameters.params.map(paramNode => {
                if (t.isStringLiteralTypeAnnotation(paramNode)) {
                  console.warn(
                    `===> Downgrading ElementRef JSX intrinsic type '${paramNode.value}' to Element. You can manually replace with a more specific type.`
                  );
                  return t.tsTypeReference(t.identifier("Element"));
                } else if (t.isGenericTypeAnnotation(paramNode)) {
                  return t.tsTypeReference(toTSEntityName(paramNode.id));
                } else if (t.isTypeofTypeAnnotation(paramNode)) {
                  return t.tsTypeQuery(
                    (toTSType(paramNode.argument) as any).id
                  );
                }
                return paramNode;
              })
            )
          )
        );
      }
    }
    path.scope.rename("ElementRef", "RefObject");
    if (specifier.type === "ImportSpecifier") {
      specifier.imported = specifier.local;
    }
  }
};

const transform: Visitor<VisitorState> = {
  Program: {
    enter(path, state) {
      const { body } = path.node;

      for (let i = 0; i < body.length; i++) {
        const stmt = body[i];

        // Workaround babylon bug where only the first leading comment is
        // attached VariableDeclarations.
        // TODO: file a ticket for this bug
        if (i === 0 && t.isVariableDeclaration(stmt)) {
          if (stmt.leadingComments && stmt.leadingComments[0]) {
            const firstComment = stmt.leadingComments[0];
            if (stmt.loc) {
              for (
                let i = firstComment.loc.end.line + 1;
                i < stmt.loc.start.line;
                i++
              ) {
                if (state.comments.startLine[i]) {
                  stmt.leadingComments = [
                    ...stmt.leadingComments,
                    state.comments.startLine[i]
                  ];
                }
              }
            }
          }
        }

        // filter out flow specific comments
        if (stmt.leadingComments) {
          stmt.leadingComments = stmt.leadingComments.filter(comment => {
            const value = comment.value.trim();
            return value !== "@flow" && !value.startsWith("$FlowFixMe");
          });
        }
        if (stmt.trailingComments) {
          stmt.trailingComments = stmt.trailingComments.filter(comment => {
            const value = comment.value.trim();
            return value !== "@flow" && !value.startsWith("$FlowFixMe");
          });
        }
      }

      if (body.length > 0) {
        path.node.newlines = computeNewlines(path.node);

        // Attach the number of trailing spaces to the state so that convert.js
        // can add those back since babel-generator/lib/buffer.js removes them.
        // TODO: compute this properly
        state.trailingLines = 0;
      }
    },
    exit(path, state) {
      const { body } = path.node;
      if (state.usedUtilityTypes.size > 0) {
        const specifiers = [...state.usedUtilityTypes].map(name => {
          const imported = t.identifier(name);
          const local = t.identifier(name);
          return t.importSpecifier(local, imported);
        });
        const source = t.stringLiteral("utility-types");
        const importDeclaration = t.importDeclaration(specifiers, source);
        path.node.body = [importDeclaration, ...path.node.body];
        if (path.node.newlines) {
          path.node.newlines = [
            [], // place the new import at the start of the file
            [undefined, ...path.node.newlines[0]],
            ...path.node.newlines.slice(1)
          ];
        } else {
          path.node.newlines = [[], [undefined]];
        }
      }
    }
  },
  BlockStatement: {
    // TODO: deal with empty functions
    enter(path) {
      const { body } = path.node;
      if (body.length > 0) {
        path.node.newlines = computeNewlines(path.node);
      }
    }
  },
  ObjectExpression: {
    enter(path) {
      const { properties } = path.node;
      if (properties.length > 0) {
        path.node.newlines = computeNewlines(path.node);
      }
    }
  },
  SwitchStatement: {
    enter(path) {
      const { cases } = path.node;
      if (cases.length > 0) {
        path.node.newlines = computeNewlines(path.node);
      }
    }
  },
  ClassBody: {
    enter(path) {
      const { body } = path.node;
      if (body.length > 0) {
        path.node.newlines = computeNewlines(path.node);
      }
    }
  },

  // Basic Types
  StringTypeAnnotation(path) {
    path.replaceWith(t.tsStringKeyword());
  },
  BooleanTypeAnnotation(path) {
    path.replaceWith(t.tsBooleanKeyword());
  },
  NumberTypeAnnotation(path) {
    path.replaceWith(t.tsNumberKeyword());
  },
  AnyTypeAnnotation(path) {
    path.replaceWith(t.tsAnyKeyword());
  },
  VoidTypeAnnotation(path) {
    path.replaceWith(t.tsUndefinedKeyword());
  },
  MixedTypeAnnotation(path) {
    path.replaceWith(t.tsUnknownKeyword());
  },
  EmptyTypeAnnotation(path) {
    path.replaceWith(t.tsNeverKeyword());
  },
  ExistsTypeAnnotation(path) {
    console.warn("===> downgrading * to any");
    path.replaceWith(t.tsAnyKeyword());
  },

  // Literals
  StringLiteralTypeAnnotation(path) {
    path.replaceWith(t.tsLiteralType(t.stringLiteral(path.node.value)));
  },
  BooleanLiteralTypeAnnotation(path) {
    path.replaceWith(t.tsLiteralType(t.booleanLiteral(path.node.value)));
  },
  NumberLiteralTypeAnnotation(path) {
    path.replaceWith(t.tsLiteralType(t.numericLiteral(path.node.value)));
  },
  NullLiteralTypeAnnotation(path) {
    path.replaceWith(t.tsNullKeyword());
  },

  // It's okay to process these non-leaf nodes on enter()
  // since we're modifying them in a way doesn't affect
  // the processing of other nodes.
  FunctionDeclaration(path) {
    if (path.node.predicate) {
      console.warn(
        `===> removing %checks at ${locToString(path.node.predicate.loc)}`
      );
      delete path.node.predicate;
    }
  },
  FunctionExpression(path) {
    if (path.node.predicate) {
      console.warn(
        `===> removing %checks at ${locToString(path.node.predicate.loc)}`
      );
      delete path.node.predicate;
    }
  },
  ArrowFunctionExpression(path) {
    if (path.node.predicate) {
      console.warn(
        `===> removing %checks at ${locToString(path.node.predicate.loc)}`
      );
      delete path.node.predicate;
    }
  },

  // All other non-leaf nodes must be processed on exit()
  TypeAnnotation: {
    exit(path) {
      const { typeAnnotation } = path.node;
      path.replaceWith(t.tsTypeAnnotation(toTSType(typeAnnotation)));
    }
  },
  NullableTypeAnnotation: {
    exit(path) {
      const { typeAnnotation } = path.node;
      path.replaceWith(
        t.tsUnionType([
          toTSType(
            // conditionally unwrap TSTypeAnnotation nodes
            t.isTSTypeAnnotation(typeAnnotation)
              ? typeAnnotation.typeAnnotation
              : typeAnnotation
          ),
          t.tsNullKeyword(),
          t.tsUndefinedKeyword()
        ])
      );
    }
  },
  ArrayTypeAnnotation: {
    exit(path) {
      const { elementType } = path.node;
      path.replaceWith(t.tsArrayType(toTSType(elementType)));
    }
  },
  TupleTypeAnnotation: {
    exit(path) {
      const { types } = path.node;
      const elementTypes = types;
      path.replaceWith(t.tsTupleType(toTSTypeArray(elementTypes)));
    }
  },
  FunctionTypeAnnotation: {
    exit(path) {
      const { typeParameters, params, rest, returnType } = path.node;
      const parameters: (t.Identifier | t.RestElement)[] = params.map(
        (param: t.Node, index): t.Identifier => {
          // Param should have been transformed to an Identifier in FunctionTypeParam
          // visitor.
          if (param.type !== "Identifier") {
            throw new Error("Identifier transformation did not take occur");
          }
          return { ...param, name: param.name || `arg${index}` };
        }
      );

      const restNode: t.Node | null = rest as any;
      if (restNode && restNode.type === "Identifier") {
        const restElement: t.RestElement = {
          type: "RestElement",
          argument: restNode,
          decorators: [], // flow doesn't support decorators
          typeAnnotation: restNode.typeAnnotation,
          ...BaseNodeDefaultSpreadTypes
        };
        // TODO: patch @babel/types - t.restElement omits typeAnnotation
        // const restElement = t.restElement(rest, [], rest.typeAnnotation);
        parameters.push(restElement);
        delete restNode.typeAnnotation;
      }
      const typeAnnotation = t.tsTypeAnnotation(toTSType(returnType));

      const parentNode = path.parentPath && path.parentPath.node;
      let tsReplacementType:
        | t.TSFunctionType
        | t.TSParenthesizedType = t.tsFunctionType(
        typeParameters
          ? toTSTypeParameterDeclaration(typeParameters)
          : typeParameters,
        parameters,
        typeAnnotation
      );

      // In a Flow ObjectTypeAnnotation, it is acceptable to have a property
      // union or intersection type contain a unparenthesized function type.
      // This is not acceptable with TS.
      if (
        parentNode &&
        (t.isUnionTypeAnnotation(parentNode) ||
          t.isIntersectionTypeAnnotation(parentNode) ||
          t.isTSUnionType(parentNode) ||
          t.isTSIntersectionType(parentNode))
      ) {
        tsReplacementType = t.tsParenthesizedType(tsReplacementType);
      }

      path.replaceWith(tsReplacementType);
    }
  },
  FunctionTypeParam: {
    exit(path) {
      // Transforms all FunctionTypeParam => Identifier
      // TypeScript AST simplifies these annotations in a single TSFunctionType
      const { name, optional, typeAnnotation } = path.node;
      const identifier: t.Identifier = {
        type: "Identifier",
        name: name ? name.name : "",
        optional,
        typeAnnotation: t.tsTypeAnnotation(toTSType(typeAnnotation)),
        decorators: [],
        leadingComments: null,
        innerComments: null,
        trailingComments: null,
        start: null,
        end: null,
        loc: null,
        newlines: undefined
      };
      // TODO: patch @babel/types - t.identifier omits typeAnnotation
      // const identifier = t.identifier(name.name, decorators, optional, t.tsTypeAnnotation(typeAnnotation));
      path.replaceWith(identifier);
    }
  },
  TypeParameterInstantiation: {
    exit(path) {
      path.replaceWith(toTSTypeParameterInstantiation(path.node));
    }
  },
  TypeParameterDeclaration: {
    exit(path) {
      path.replaceWith(toTSTypeParameterDeclaration(path.node));
    }
  },
  TypeParameter: {
    exit(path) {
      const { name, variance, bound, default: defaultProperty } = path.node;
      if (variance) {
        console.warn(
          "===> TypeScript doesn't support variance on type parameters"
        );
      }

      const typeParameter: t.TSTypeParameter = {
        type: "TSTypeParameter",
        constraint: bound ? toTSType(bound.typeAnnotation) : bound,
        default: defaultProperty ? toTSType(defaultProperty) : defaultProperty,
        name: name || "",
        ...BaseNodeDefaultSpreadTypes
      };

      // Flow: <T>() => {}
      // TS: <T extends {}>() => {}
      if (
        path.parentPath &&
        path.parentPath.parentPath &&
        t.isArrowFunctionExpression(path.parentPath.parentPath) &&
        !typeParameter.constraint
      ) {
        typeParameter.constraint = t.tsTypeLiteral([]);
      }

      // TODO: patch @babel/types - tsTypeParameter omits name
      // const typeParameter = t.tsTypeParameter(constraint, _default, name));
      path.replaceWith(typeParameter);
    }
  },
  GenericTypeAnnotation: {
    exit(path, state) {
      const { id: idNode, typeParameters } = path.node;
      const id:
        | t.Identifier
        | t.QualifiedTypeIdentifier
        | t.TSQualifiedName = idNode as any;
      if (id.type === "Identifier" && id.name in utilityTypes) {
        if (
          typeParameters &&
          (alwaysInlineUtilityTypes.find(p => p === id.name) ||
            state.options.inlineUtilityTypes) &&
          typeof utilityTypes[id.name] === "function"
        ) {
          const inline = utilityTypes[id.name];
          path.replaceWith(inline(...typeParameters.params));
          return;
        } else {
          state.usedUtilityTypes.add(id.name);
        }
      }

      const tsTypeParameterInstantiation = typeParameters
        ? toTSTypeParameterInstantiation(typeParameters)
        : typeParameters;
      if (id.type === "Identifier" && id.name in UnqualifiedReactTypeNameMap) {
        // TODO: make sure that React was imported in this file
        // This will leave future visits with some id nodes as TSQualifiedName
        path.replaceWith(
          t.tsTypeReference(
            t.tsQualifiedName(
              t.identifier("React"),
              t.identifier(UnqualifiedReactTypeNameMap[id.name])
            ),
            tsTypeParameterInstantiation
          )
        );
      } else if (id.type !== "QualifiedTypeIdentifier") {
        console.assert(
          id.type === "Identifier" || id.type === "TSQualifiedName"
        );
        path.replaceWith(t.tsTypeReference(id, tsTypeParameterInstantiation));
      }
    }
  },
  QualifiedTypeIdentifier: {
    exit(path) {
      const { qualification: left, id: right } = path.node;
      if (left.type !== "Identifier") {
        return;
      }

      if (left.name === "React" && right.name in QualifiedReactTypeNameMap) {
        path.replaceWith(
          t.tsQualifiedName(
            left,
            t.identifier(QualifiedReactTypeNameMap[right.name])
          )
        );
      } else {
        path.replaceWith(t.tsQualifiedName(left, right));
      }
    }
  },
  ObjectTypeProperty: {
    exit(path) {
      const {
        key,
        value: valueNode,
        optional,
        variance,
        kind,
        method
      } = path.node; // TODO: static, kind
      const value = toTSType(valueNode);
      const typeAnnotation = t.tsTypeAnnotation(value);
      const initializer = null; // TODO: figure out when this used
      const computed = false; // TODO: maybe set this to true for indexers
      const readonly = variance && variance.kind === "plus";

      if (variance && variance.kind === "minus") {
        // TODO: include file and location of infraction
        console.warn("===> typescript doesn't support writeonly properties");
      }
      if (kind !== "init") {
        console.warn("===> we don't handle get() or set() yet, :P");
      }

      if (method) {
        if (value.type === "TSFunctionType") {
          const methodSignature: t.TSMethodSignature = {
            ...BaseNodeDefaultSpreadTypes,
            type: "TSMethodSignature",
            key,
            typeParameters: value.typeParameters
              ? toTSTypeParameterDeclaration(value.typeParameters)
              : value.typeParameters,
            parameters: value.parameters,
            typeAnnotation: value.typeAnnotation,
            computed,
            optional
          };
          path.replaceWith(methodSignature);
        } else if (t.isFunctionTypeAnnotation(value)) {
          // Conversion should have happened prior to reaching this
          throw new Error("Unexpected type FunctionTypeAnnotation encountered");
        }
        // TODO: patch @babel/types - tsMethodSignature ignores two out of the six params
        // const methodSignature = t.tsMethodSignature(key, value.typeParameters, value.parameters, value.typeAnnotation, computed, optional);
      } else {
        const propertySignature: t.TSPropertySignature = {
          ...BaseNodeDefaultSpreadTypes,
          type: "TSPropertySignature",
          key,
          typeAnnotation,
          initializer,
          computed,
          optional,
          readonly
        };
        // TODO: patch @babel/types - tsPropertySignature ignores typeAnnotation, optional, and readonly
        // const = propertySignature = t.tsPropertySignature(key, typeAnnotation, initializer, computed, optional, readonly),
        path.replaceWith(propertySignature);
      }
    }
  },
  ObjectTypeIndexer: {
    exit(path) {
      const { id, key, value, variance } = path.node;
      const readonly = variance && variance.kind === "plus";
      if (variance && variance.kind === "minus") {
        // TODO: include file and location of infraction
        console.warn("===> typescript doesn't support writeonly properties");
      }

      const identifier: t.Identifier = {
        ...BaseNodeDefaultSpreadTypes,
        type: "Identifier",
        name: id ? id.name : "key",
        typeAnnotation: t.tsTypeAnnotation(toTSType(key)),
        decorators: null,
        optional: null
      };
      // TODO: patch @babel/types - t.identifier omits typeAnnotation
      // const identifier = t.identifier(name.name, decorators, optional, t.tsTypeAnnotation(typeAnnotation));

      const indexSignature: t.TSIndexSignature = {
        ...BaseNodeDefaultSpreadTypes,
        type: "TSIndexSignature",
        parameters: [identifier], // TODO: figure when multiple parameters are used
        typeAnnotation: t.tsTypeAnnotation(toTSType(value)),
        readonly
      };
      // TODO: patch @babel/types - t.tsIndexSignature omits readonly
      // const indexSignature = t.tsIndexSignature([identifier], t.tsTypeAnnotation(value), readonly);
      path.replaceWith(indexSignature);
    }
  },
  ObjectTypeAnnotation: {
    enter(path, state) {
      const { properties } = path.node;
      if (properties.length > 0) {
        // Workaround babylon bug where the last ObjectTypeProperty in an
        // ObjectTypeAnnotation doesn't have its trailingComments.
        // TODO: file a ticket for this bug
        const trailingComments: t.File["comments"][] = [];
        const lastProp = properties[properties.length - 1];
        if (lastProp.loc && path.node.loc) {
          for (let i = lastProp.loc.end.line; i < path.node.loc.end.line; i++) {
            if (state.comments.startLine[i]) {
              trailingComments.push(state.comments.startLine[i]);
            }
          }
        }
        lastProp.trailingComments = trailingComments;
        path.node.newlines = computeNewlines(path.node);
      }
    },
    exit(path) {
      const { exact, properties, indexers } = path.node; // TODO: callProperties, inexact

      if (exact) {
        console.warn("===> downgrading exact object type");
      }

      // TODO: create multiple sets of elements so that we can convert
      // {x: number, ...T, y: number} to {x: number} & T & {y: number}
      const elements: t.TSTypeElement[] = [];
      const spreads: t.TSType[] = [];

      for (const prop of properties) {
        if (t.isObjectTypeSpreadProperty(prop)) {
          const { argument } = prop;
          spreads.push(toTSType(argument));
        } else {
          elements.push(prop as TodoAny);
        }
      }

      // TODO: maintain the position of indexers
      elements.push(...(indexers as TodoAny));

      if (spreads.length > 0 && elements.length > 0) {
        path.replaceWith(
          t.tsIntersectionType([...spreads, t.tsTypeLiteral(elements)])
        );
      } else if (spreads.length > 0) {
        path.replaceWith(t.tsIntersectionType(spreads));
      } else {
        const typeLiteral = t.tsTypeLiteral(elements);
        typeLiteral.newlines = path.node.newlines;
        path.replaceWith(typeLiteral);
      }
    }
  },
  TypeAlias: {
    exit(path) {
      const { id, typeParameters, right } = path.node;
      path.replaceWith(
        t.tsTypeAliasDeclaration(
          id,
          typeParameters
            ? toTSTypeParameterDeclaration(typeParameters)
            : typeParameters,
          toTSType(right)
        )
      );
    }
  },
  IntersectionTypeAnnotation: {
    exit(path) {
      const { types } = path.node;
      path.replaceWith(t.tsIntersectionType(toTSTypeArray(types)));
    }
  },
  UnionTypeAnnotation: {
    exit(path) {
      const { types } = path.node;
      path.replaceWith(t.tsUnionType(toTSTypeArray(types)));
    }
  },
  TypeofTypeAnnotation: {
    exit(path) {
      const { argument: argumentNode } = path.node;
      // argument has already been converted from GenericTypeAnnotation to
      // TSTypeReference.
      const argument: t.TSTypeReference = argumentNode as any;
      console.assert(argument.type === "TSTypeReference");
      const exprName = argument.typeName;
      path.replaceWith(t.tsTypeQuery(exprName));
    }
  },
  TypeCastExpression: {
    exit(path, state) {
      const { expression, typeAnnotation } = path.node;
      // TODO: figure out how to get this working with prettier and make it configurable
      // const typeCastExpression = {
      //   type: "TSTypeCastExpression",
      //   expression,
      //   typeAnnotation,
      // };
      // TODO: add tsTypeCastExpression to @babel/types
      // const typeCastExpression = t.tsTypeCastExpression(expression, typeAnnotation);
      const tsAsExpression = t.tsAsExpression(
        expression,
        toTSType(typeAnnotation.typeAnnotation)
      );
      path.replaceWith(tsAsExpression);
    }
  },
  InterfaceDeclaration: {
    exit(path) {
      const {
        id,
        typeParameters,
        body: bodyNode,
        extends: extendsNode
      } = path.node; // TODO: implements, mixins
      const body: t.TSTypeLiteral = bodyNode as any;
      console.assert(t.isTSTypeLiteral(body));
      const tsInterfaceBody = t.tsInterfaceBody(body.members);
      const _extends: t.TSExpressionWithTypeArguments[] | undefined =
        extendsNode && extendsNode.length > 0
          ? (extendsNode as any)
          : undefined;
      path.replaceWith(
        t.tsInterfaceDeclaration(
          id,
          typeParameters
            ? toTSTypeParameterDeclaration(typeParameters)
            : typeParameters,
          _extends,
          tsInterfaceBody
        )
      );
    }
  },
  InterfaceExtends: {
    exit(path) {
      const { id: idNode, typeParameters } = path.node;
      console.assert(!t.isQualifiedTypeIdentifier(idNode));
      const id: t.Identifier | t.TSQualifiedName = idNode as any;
      path.replaceWith(
        t.tsExpressionWithTypeArguments(
          id,
          typeParameters
            ? toTSTypeParameterInstantiation(typeParameters)
            : typeParameters
        )
      );
    }
  },
  ClassImplements: {
    exit(path) {
      const { id, typeParameters } = path.node;
      path.replaceWith(
        t.tsExpressionWithTypeArguments(
          id,
          typeParameters
            ? toTSTypeParameterInstantiation(typeParameters)
            : typeParameters
        )
      );
    }
  },
  ImportDeclaration: {
    exit(path) {
      // Rename React imports that are directly imported
      if (path.node.source.value === "react") {
        for (const specifier of path.node.specifiers) {
          if (specifier.type === "ImportSpecifier" && specifier.imported) {
            const flowName = specifier.imported.name;
            const transformation = ImportSpecifierReactTypeNameMap[flowName];
            if (typeof transformation === "string") {
              path.scope.rename(
                flowName,
                transformation
              );
              specifier.imported = specifier.local;
            } else if (typeof transformation === "function") {
              transformation(path, specifier);
            }
          }
        }
      }

      path.node.importKind = "value";
      // TODO: make this configurable so we can output .ts[x]?
      const src = path.node.source.value.startsWith("./")
        ? path.node.source.value.replace(/\.js[x]?$/, "")
        : path.node.source.value;
      path.node.source = t.stringLiteral(src);
    }
  },
  ImportSpecifier: {
    exit(path) {
      path.node.importKind = "value" as TodoAny;
    }
  },
  DeclareVariable: {
    exit(path) {
      const { id } = path.node;

      // TODO: patch @babel/types - t.variableDeclaration omits declare param
      // const declaration = t.variableDeclaration("var", [
      //   t.variableDeclarator(id),
      // ], true),
      const variableDeclaration: t.VariableDeclaration = {
        ...BaseNodeDefaultSpreadTypes,
        type: "VariableDeclaration",
        kind: "var",
        declarations: [t.variableDeclarator(id)],
        declare: true
      };
      path.replaceWith(variableDeclaration);
    }
  },
  DeclareClass: {
    exit(path) {
      const { id, body, typeParameters, extends: _extends } = path.node;
      const superClass =
        _extends && _extends.length > 0 ? _extends[0] : null;

      // TODO: patch @babel/types - t.classDeclaration omits typescript params
      // t.classDeclaration(id, superClass, body, [], false, true, [], undefined)
      const classDeclaration = {
        type: "ClassDeclaration",
        id,
        typeParameters,
        superClass: superClass as TodoAny,
        superClassTypeParameters: superClass
          ? superClass.typeParameters as TodoAny
          : undefined,
        body: body as TodoAny,
        declare: true
      };
      path.replaceWith(classDeclaration as TodoAny);
    }
  },
  DeclareFunction: {
    exit(path) {
      const { id } = path.node;
      const { name, typeAnnotation } = id;
      
      if (!t.isTSTypeAnnotation(typeAnnotation) || !t.isTSFunctionType(typeAnnotation.typeAnnotation)) {
        return;
      }
      // TSFunctionType
      const functionType = typeAnnotation.typeAnnotation;

      // TODO: patch @babel/types - t.tsDeclaration only accepts 4 params but should accept 7
      // t.tsDeclareFunction(
      //   t.identifier(name),
      //   t.noop(),
      //   functionType.parameters,
      //   functionType.typeAnnotation,
      //   false, // async
      //   true,
      //   false, // generator
      // ),

      const tsDeclareFunction: t.TSDeclareFunction = {
        ...BaseNodeDefaultSpreadTypes,
        type: "TSDeclareFunction",
        id: t.identifier(name),
        typeParameters: functionType.typeParameters,
        params: functionType.parameters,
        returnType: functionType.typeAnnotation,
        declare: !t.isDeclareExportDeclaration(path.parent),
        async: false, // TODO
        generator: false, // TODO
        predicate: null
      };
      path.replaceWith(tsDeclareFunction);
    }
  },
  DeclareExportDeclaration: {
    exit(path) {
      const { declaration, default: _default } = path.node;
      if (_default) {
        path.replaceWith({
          type: "ExportDefaultDeclaration",
          declaration
        } as t.ExportDefaultDeclaration);
      } else {
        path.replaceWith({
          type: "ExportNamedDeclaration",
          declaration
        } as t.ExportNamedDeclaration);
      }
    }
  },
  OpaqueType: {
    exit(path, state) {
      state.usedUtilityTypes.add("Brand");
      const { id, impltype } = path.node;
      // Convert declaration to utility-types' Brand type
      path.replaceWith(
        t.tsTypeAliasDeclaration(
          id,
          null,
          t.tsTypeReference(
            t.identifier("Brand"),
            t.tsTypeParameterInstantiation([
              toTSType(impltype),
              t.tsLiteralType(t.stringLiteral(id.name))
            ])
          )
        )
      );

      // Attempt to update all references in this file
      const binding = path.scope.bindings[id.name];
      if (binding) {
        for (let i = 1; i < binding.referencePaths.length; i++) {
          // skip first, which is reference to itself
          const parentPath = binding.referencePaths[i].findParent(path =>
            path.isIdentifier()
          );

          if (parentPath) {
            const variablePath = parentPath.findParent(path =>
              t.isVariableDeclaration(path.node)
            );

            if (variablePath && t.isVariableDeclaration(variablePath.node)) {
              const { node } = variablePath;
              const declarations = node.declarations.map(n => {
                let typeAnnotation: t.TSTypeReference | undefined;
                // If this variable declaration is annotated with a type
                if (hasTypeAnnotation(n.id) && n.id.typeAnnotation && !t.isNoop(n.id.typeAnnotation)) {
                  const flowTypeAnnotation = n.id.typeAnnotation.typeAnnotation;
                  switch (flowTypeAnnotation.type) {
                    case "GenericTypeAnnotation":
                      if (t.isIdentifier(flowTypeAnnotation.id)) {
                        typeAnnotation = t.tsTypeReference(flowTypeAnnotation.id);
                      }
                      break;
                    // TODO: tsAsExpression of the union type.
                    // Complexity here is that other types have not yet been converted at this traversal point.
                    // Don't want to repeat logic. Maybe move to other visitor.
                    case "UnionTypeAnnotation":
                    default:
                      console.warn(
                        `===> Skipping type conversion of opaque complex type ${flowTypeAnnotation.type}`
                      );
                  }
                }
                return t.variableDeclarator(
                  n.id,
                  typeAnnotation && n.init
                    ? t.tsAsExpression(n.init, typeAnnotation)
                    : n.init
                );
              });
              variablePath.replaceWith(
                t.variableDeclaration(node.kind, declarations)
              );
            }
          }

          const arrowFunctionExpressionPath = binding.referencePaths[
            i
          ].findParent(path => t.isArrowFunctionExpression(path.node));
          if (arrowFunctionExpressionPath) {
            const { node } = arrowFunctionExpressionPath;
            // If this arrow function expression is annotated with a return type
            if (t.isArrowFunctionExpression(node) && node.returnType && !t.isNoop(node.returnType)) {
              const returnType = (node.returnType.typeAnnotation as TodoAny).id; // TODO again only works for GenericTypeAnnotation
              if (returnType && returnType.name === id.name) {
                if (t.isBlockStatement(node.body)) {
                  for (let i = 0; i < node.body.body.length; i++) {
                    const returnStatementBodyNode = node.body.body[i];
                    if (t.isReturnStatement(returnStatementBodyNode) && returnStatementBodyNode.argument) {
                      returnStatementBodyNode.argument = t.tsAsExpression(
                        returnStatementBodyNode.argument,
                        t.tsTypeReference(returnType)
                      );
                    }
                  }
                } else {
                  node.body = t.tsAsExpression(
                    node.body,
                    t.tsTypeReference(returnType)
                  );
                }
              }
            }
          }
        }
      }
    }
  },
  ExportNamedDeclaration: {
    exit(path) {
      // Flow: export type { Foo } from './foo'
      // TS: export { Foo } from './foo'
      const { exportKind, declaration } = path.node;
      if (exportKind === "type" && !declaration) {
        // export of existing declared variable
        path.replaceWith({
          ...path.node,
          exportKind: "value"
        });
      }
    }
  },
  // Alias for all JSX types
  // https://github.com/babel/babel/blob/master/packages/babel-types/src/definitions/jsx.js
  JSX: {
    exit(_, state) {
      state.containsJSX = true;
    }
  }
};

export default transform;
