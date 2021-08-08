import { TSESTree } from '@typescript-eslint/experimental-utils';

import parseFileForExports from './getTypeExports';
import getExports from './getExports';
import { exportFixer, importFixer } from '../fix';
import { RuleFixer } from '@typescript-eslint/experimental-utils/dist/ts-eslint';

function errorMessage(action: string, statement: string, name: string): string {
  return `Do not ${action}port '${name}' it is an ${statement}ported type or interface.`;
}

function isTypeStatement(
  node: TSESTree.ExportNamedDeclaration | TSESTree.ImportDeclaration,
): boolean {
  return (
    (node as TSESTree.ExportNamedDeclaration).exportKind === 'type' ||
    (node as TSESTree.ImportDeclaration).importKind === 'type'
  );
}

function isExport(
  exported: TSESTree.ExportSpecifier | TSESTree.ImportClause,
): exported is TSESTree.ExportSpecifier {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return (<TSESTree.ExportSpecifier>exported).exported !== undefined;
}

function getTypeDefinitions(ast: TSESTree.Program): Set<string> {
  const declarations: Set<string> = new Set();
  try {
    ast.body.forEach(node => {
      if (node.type === 'TSInterfaceDeclaration') {
        const { id, body } = node;
        if (body.type === 'TSInterfaceBody') {
          declarations.add(id.name);
        }
      } else if (node.type === 'TSTypeAliasDeclaration') {
        const { id, typeAnnotation } = node;
        if (
          ['TSFunctionType', 'TSTypeReference', 'TSUnionType'].includes(
            typeAnnotation.type,
          )
        ) {
          declarations.add(id.name);
        }
      }
    });
  } catch (error) {
    return declarations;
  }
  return declarations;
}

function isInterface(name: string): boolean {
  return name[0] === 'I' && name[1] === name[1].toUpperCase();
}

function getInterfaceImports(ast: TSESTree.Program): Set<string> {
  const interfaces: Set<string> = new Set();
  try {
    ast.body.forEach(node => {
      if (node.type === 'ImportDeclaration') {
        node.specifiers.forEach(specifier => {
          if (specifier.type === 'ImportSpecifier') {
            if (
              isInterface(specifier.local.name) ||
              isInterface(specifier.imported.name)
            ) {
              if (specifier.local.name !== specifier.imported.name) {
                interfaces.add(
                  `${specifier.imported.name} as ${specifier.local.name}`,
                );
              } else {
                interfaces.add(specifier.local.name);
              }
            }
          }
        });
      }
    });
  } catch (error) {
    return interfaces;
  }
  return interfaces;
}

function findInSet(needle: string, haystack: Set<string>): boolean {
  return [...haystack].map(hay => hay.indexOf(needle) !== -1).includes(true);
}

export = {
  name: 'no-explicit-type-exports',
  meta: {
    type: 'problem',
    fixable: 'code',
  },
  create: function (
    context: any,
  ): {
    ImportDeclaration: (node: TSESTree.ImportDeclaration) => void;
    ExportNamedDeclaration: (node: TSESTree.ExportNamedDeclaration) => void;
  } {
    const AllTypedImports: string[] = [];
    const AllRegularImports: string[] = [];

    const getImportExportDeclarations = (type: string) => (
      node: TSESTree.ImportDeclaration | TSESTree.ExportNamedDeclaration,
    ): void => {
      const { ast } = context.getSourceCode();
      const { source } = node;

      const typeDefinitions = getTypeDefinitions(ast);
      const interfaceImports = getInterfaceImports(ast);

      const sourceName = source && 'value' in source ? source.value : undefined;

      if (typeof sourceName === 'string') {
        const typedExports = parseFileForExports(sourceName, context);
        const regularExports = getExports(ast);
        const typedImports: string[] = [];
        const regularImports: string[] = [];

        if (typedExports) {
          node.specifiers.forEach(
            (specifier: TSESTree.ExportSpecifier | TSESTree.ImportClause) => {
              const { name } = specifier.local;
              if (specifier.type === 'ImportSpecifier') {
                let importedName = name;
                if (name !== specifier.imported.name) {
                  importedName = `${specifier.imported.name} as ${name}`;
                }
                if (
                  findInSet(name, typedExports) ||
                  !findInSet(name, regularExports) ||
                  interfaceImports.has(name) ||
                  findInSet(name, regularExports)
                ) {
                  typedImports.push(importedName);
                  AllTypedImports.push(importedName);
                } else {
                  regularImports.push(importedName);
                  AllRegularImports.push(importedName);
                }
              }
            },
          );

          getExports(ast).forEach(exp => {
            if (
              typedImports.includes(exp) &&
              !AllRegularImports.includes(exp) &&
              !isTypeStatement(node)
            ) {
              const isExport = type === 'ExportNamedDeclaration';
              context.report({
                node,
                message: errorMessage(
                  isExport ? 'ex' : 'im',
                  isExport ? 'im' : 'ex',
                  exp,
                ),
                fix: (fixer: RuleFixer) =>
                  isExport
                    ? exportFixer(
                      node as TSESTree.ExportNamedDeclaration,
                      typedImports,
                      regularImports,
                      fixer,
                    )
                    : importFixer(
                      node as TSESTree.ImportDeclaration,
                      typedImports,
                      regularImports,
                      fixer,
                    ),
              });
            }
          });
        }
      } else if (type === 'ExportNamedDeclaration') {
        const typedExports: string[] = [];
        const regularExports: string[] = [];
        node.specifiers.forEach(
          (specifier: TSESTree.ExportSpecifier | TSESTree.ImportClause) => {
            const { name } = specifier.local;
            let exportedName = name;
            if (isExport(specifier)) {
              if (specifier.exported.name !== name) {
                exportedName = `${name} as ${specifier.exported.name}`;
              }
            }
            if (
              (AllTypedImports.includes(exportedName) &&
                !AllRegularImports.includes(exportedName)) ||
              typeDefinitions.has(name) ||
              interfaceImports.has(name) ||
              AllRegularImports.includes(exportedName)
            ) {
              if (name === exportedName) {
                typedExports.push(name);
              } else {
                typedExports.push(exportedName);
              }
            } else {
              regularExports.push(name);
            }
          },
        );
        if (typedExports.length && !isTypeStatement(node)) {
          context.report({
            node,
            message: errorMessage('ex', 'ex', typedExports[0]),
            fix: (fixer: RuleFixer) =>
              exportFixer(
                node as TSESTree.ExportNamedDeclaration,
                typedExports,
                regularExports,
                fixer,
              ),
          });
        }
      }
    };

    return {
      ImportDeclaration: getImportExportDeclarations('ImportDeclaration'),
      ExportNamedDeclaration: getImportExportDeclarations(
        'ExportNamedDeclaration',
      ),
    };
  },
};
