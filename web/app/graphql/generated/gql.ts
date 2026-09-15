/* eslint-disable */
import * as types from './graphql';
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "fragment ArticleCard on Article {\n  id\n  title\n  slug\n  dek\n  excerpt\n  featuredImage\n  publishedAt\n  author {\n    name\n    slug\n    photoUrl\n  }\n  contentType {\n    name\n    slug\n  }\n}\n\nfragment ArticleStatusValue on Article {\n  status\n}\n\nfragment PopularArticle on Article {\n  id\n  title\n  slug\n  author {\n    name\n    slug\n  }\n  contentType {\n    name\n    slug\n  }\n}": typeof types.ArticleCardFragmentDoc,
    "fragment AuthorSummary on User {\n  id\n  name\n  email\n  bio\n  photoUrl\n  role\n  slug\n  socialLinks\n  createdAt\n  updatedAt\n}": typeof types.AuthorSummaryFragmentDoc,
    "fragment ContentTypeSummary on ContentType {\n  id\n  name\n  slug\n  description\n  order\n  status\n  createdAt\n  updatedAt\n}\n\nfragment SectionTagSummary on SectionTag {\n  id\n  name\n  slug\n  description\n  createdAt\n  updatedAt\n}": typeof types.ContentTypeSummaryFragmentDoc,
};
const documents: Documents = {
    "fragment ArticleCard on Article {\n  id\n  title\n  slug\n  dek\n  excerpt\n  featuredImage\n  publishedAt\n  author {\n    name\n    slug\n    photoUrl\n  }\n  contentType {\n    name\n    slug\n  }\n}\n\nfragment ArticleStatusValue on Article {\n  status\n}\n\nfragment PopularArticle on Article {\n  id\n  title\n  slug\n  author {\n    name\n    slug\n  }\n  contentType {\n    name\n    slug\n  }\n}": types.ArticleCardFragmentDoc,
    "fragment AuthorSummary on User {\n  id\n  name\n  email\n  bio\n  photoUrl\n  role\n  slug\n  socialLinks\n  createdAt\n  updatedAt\n}": types.AuthorSummaryFragmentDoc,
    "fragment ContentTypeSummary on ContentType {\n  id\n  name\n  slug\n  description\n  order\n  status\n  createdAt\n  updatedAt\n}\n\nfragment SectionTagSummary on SectionTag {\n  id\n  name\n  slug\n  description\n  createdAt\n  updatedAt\n}": types.ContentTypeSummaryFragmentDoc,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "fragment ArticleCard on Article {\n  id\n  title\n  slug\n  dek\n  excerpt\n  featuredImage\n  publishedAt\n  author {\n    name\n    slug\n    photoUrl\n  }\n  contentType {\n    name\n    slug\n  }\n}\n\nfragment ArticleStatusValue on Article {\n  status\n}\n\nfragment PopularArticle on Article {\n  id\n  title\n  slug\n  author {\n    name\n    slug\n  }\n  contentType {\n    name\n    slug\n  }\n}"): (typeof documents)["fragment ArticleCard on Article {\n  id\n  title\n  slug\n  dek\n  excerpt\n  featuredImage\n  publishedAt\n  author {\n    name\n    slug\n    photoUrl\n  }\n  contentType {\n    name\n    slug\n  }\n}\n\nfragment ArticleStatusValue on Article {\n  status\n}\n\nfragment PopularArticle on Article {\n  id\n  title\n  slug\n  author {\n    name\n    slug\n  }\n  contentType {\n    name\n    slug\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "fragment AuthorSummary on User {\n  id\n  name\n  email\n  bio\n  photoUrl\n  role\n  slug\n  socialLinks\n  createdAt\n  updatedAt\n}"): (typeof documents)["fragment AuthorSummary on User {\n  id\n  name\n  email\n  bio\n  photoUrl\n  role\n  slug\n  socialLinks\n  createdAt\n  updatedAt\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "fragment ContentTypeSummary on ContentType {\n  id\n  name\n  slug\n  description\n  order\n  status\n  createdAt\n  updatedAt\n}\n\nfragment SectionTagSummary on SectionTag {\n  id\n  name\n  slug\n  description\n  createdAt\n  updatedAt\n}"): (typeof documents)["fragment ContentTypeSummary on ContentType {\n  id\n  name\n  slug\n  description\n  order\n  status\n  createdAt\n  updatedAt\n}\n\nfragment SectionTagSummary on SectionTag {\n  id\n  name\n  slug\n  description\n  createdAt\n  updatedAt\n}"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;