import { parseArgs } from 'node:util'

const GITHUB_GRAPHQL_ENDPOINT = 'https://api.github.com/graphql'

const {
  values: { repo: repoArg, user: userArg, category: categoryArg, help },
} = parseArgs({
  options: {
    repo: { type: 'string' },
    user: { type: 'string' },
    category: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

if (help) {
  console.log(
    `
Usage: node scripts/find-closed-unanswered-discussions.ts [flags]

Find discussions that are:
  - Closed with state reason RESOLVED (excludes DUPLICATE/OUTDATED)
  - Without a marked answer
  - Replied to by the target user

Flags:
  --repo <owner/name>   Repository to inspect (fallback: REPOSITORY env var)
  --user <login>        User login to match in comments/replies (default: token viewer)
  --category <value>    Filter by discussion category slug or name
  -h, --help            Show this help

Environment:
  GITHUB_TOKEN          GitHub token used for GraphQL requests (required)
  REPOSITORY            Fallback for --repo
`.trim(),
  )
  process.exit(0)
}

interface PageInfo {
  hasNextPage: boolean
  endCursor: string | null
}

interface GraphQLErrorItem {
  message: string
}

interface GraphQLResponse<T> {
  data?: T
  errors?: GraphQLErrorItem[]
}

interface DiscussionPageNode {
  number: number
  url: string
  answer: { id: string } | null
  stateReason: 'DUPLICATE' | 'OUTDATED' | 'REOPENED' | 'RESOLVED' | null
  category: {
    slug: string
    name: string
  } | null
}

interface ReplyNode {
  author: {
    login: string
  } | null
}

interface CommentNode {
  id: string
  author: {
    login: string
  } | null
  replies: {
    nodes: ReplyNode[]
    pageInfo: PageInfo
  }
}

const token = process.env.GITHUB_TOKEN
if (!token) {
  throw new Error('Missing GITHUB_TOKEN environment variable.')
}

const repository = repoArg ?? process.env.REPOSITORY
if (!repository) {
  throw new Error('Missing repository. Pass --repo <owner/name> or set REPOSITORY.')
}

const repositoryParts = repository.split('/')
if (repositoryParts.length !== 2 || !repositoryParts[0] || !repositoryParts[1]) {
  throw new Error(`Invalid repository "${repository}". Expected format: owner/name.`)
}

const owner = repositoryParts[0]
const name = repositoryParts[1]

async function graphqlRequest<T>(query: string, variables: Record<string, unknown>) {
  const response = await fetch(GITHUB_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })

  const remaining = response.headers.get('x-ratelimit-remaining')
  const reset = response.headers.get('x-ratelimit-reset')
  const rateLimitHint =
    remaining === null && reset === null
      ? ''
      : ` (rate limit remaining: ${remaining ?? 'unknown'}, reset: ${
          reset ? new Date(Number(reset) * 1000).toISOString() : 'unknown'
        })`

  if (!response.ok) {
    const bodyText = await response.text()
    throw new Error(
      `GitHub GraphQL request failed with ${response.status}: ${bodyText}${rateLimitHint}`,
    )
  }

  const body = (await response.json()) as GraphQLResponse<T>
  if (body.errors?.length) {
    const messages = body.errors.map((error) => error.message).join('; ')
    throw new Error(`GitHub GraphQL error: ${messages}${rateLimitHint}`)
  }

  if (!body.data) {
    throw new Error(`GitHub GraphQL request returned no data${rateLimitHint}`)
  }

  return body.data
}

async function resolveUserLogin() {
  if (userArg) return userArg

  const data = await graphqlRequest<{
    viewer: {
      login: string
    }
  }>(
    `
      query {
        viewer {
          login
        }
      }
    `,
    {},
  )

  return data.viewer.login
}

function categoryMatches(category: DiscussionPageNode['category'], filter: string) {
  const normalizedFilter = filter.toLowerCase()
  return (
    category?.slug.toLowerCase() === normalizedFilter ||
    category?.name.toLowerCase() === normalizedFilter
  )
}

async function fetchClosedUnansweredDiscussions(owner: string, name: string, category?: string) {
  const results: DiscussionPageNode[] = []
  let cursor: string | null = null

  for (;;) {
    const data = await graphqlRequest<{
      repository: {
        discussions: {
          nodes: DiscussionPageNode[]
          pageInfo: PageInfo
        }
      } | null
    }>(
      `
        query ($owner: String!, $name: String!, $after: String) {
          repository(owner: $owner, name: $name) {
            discussions(first: 50, after: $after, states: CLOSED, orderBy: { field: UPDATED_AT, direction: DESC }) {
              nodes {
                number
                url
                stateReason
                answer {
                  id
                }
                category {
                  slug
                  name
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `,
      { owner, name, after: cursor },
    )

    if (!data.repository) {
      throw new Error(`Repository not found or inaccessible: ${owner}/${name}`)
    }

    for (const discussion of data.repository.discussions.nodes) {
      if (
        !discussion.answer &&
        discussion.stateReason === 'RESOLVED' &&
        (!category || categoryMatches(discussion.category, category))
      ) {
        results.push(discussion)
      }
    }

    const { hasNextPage, endCursor } = data.repository.discussions.pageInfo
    if (!hasNextPage || !endCursor) break
    cursor = endCursor
  }

  return results
}

function authorMatches(author: { login: string } | null, user: string) {
  return author?.login.toLowerCase() === user.toLowerCase()
}

async function hasMatchingReplyInComment(commentId: string, user: string) {
  let cursor: string | null = null

  for (;;) {
    const data = await graphqlRequest<{
      node: {
        replies: {
          nodes: ReplyNode[]
          pageInfo: PageInfo
        }
      } | null
    }>(
      `
        query ($commentId: ID!, $after: String) {
          node(id: $commentId) {
            ... on DiscussionComment {
              replies(first: 100, after: $after) {
                nodes {
                  author {
                    login
                  }
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          }
        }
      `,
      { commentId, after: cursor },
    )

    const replies = data.node?.replies
    if (!replies) return false

    if (replies.nodes.some((reply) => authorMatches(reply.author, user))) {
      return true
    }

    const { hasNextPage, endCursor } = replies.pageInfo
    if (!hasNextPage || !endCursor) return false
    cursor = endCursor
  }
}

async function hasUserParticipation(
  owner: string,
  name: string,
  discussionNumber: number,
  user: string,
) {
  let cursor: string | null = null

  for (;;) {
    const data = await graphqlRequest<{
      repository: {
        discussion: {
          comments: {
            nodes: CommentNode[]
            pageInfo: PageInfo
          }
        } | null
      } | null
    }>(
      `
        query ($owner: String!, $name: String!, $discussionNumber: Int!, $after: String) {
          repository(owner: $owner, name: $name) {
            discussion(number: $discussionNumber) {
              comments(first: 100, after: $after) {
                nodes {
                  id
                  author {
                    login
                  }
                  replies(first: 100) {
                    nodes {
                      author {
                        login
                      }
                    }
                    pageInfo {
                      hasNextPage
                      endCursor
                    }
                  }
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          }
        }
      `,
      { owner, name, discussionNumber, after: cursor },
    )

    const comments = data.repository?.discussion?.comments
    if (!comments) return false

    for (const comment of comments.nodes) {
      if (authorMatches(comment.author, user)) return true

      if (comment.replies.nodes.some((reply) => authorMatches(reply.author, user))) {
        return true
      }

      if (comment.replies.pageInfo.hasNextPage) {
        const foundInRemainingReplies = await hasMatchingReplyInComment(comment.id, user)
        if (foundInRemainingReplies) return true
      }
    }

    const { hasNextPage, endCursor } = comments.pageInfo
    if (!hasNextPage || !endCursor) return false
    cursor = endCursor
  }
}

async function main() {
  const user = await resolveUserLogin()
  const categoryLabel = categoryArg ? ` in category "${categoryArg}"` : ''
  console.error(
    `Scanning ${owner}/${name}${categoryLabel} for closed unanswered discussions with participation by ${user}...`,
  )

  const closedUnansweredDiscussions = await fetchClosedUnansweredDiscussions(
    owner,
    name,
    categoryArg,
  )
  const matches: string[] = []

  for (const discussion of closedUnansweredDiscussions) {
    const found = await hasUserParticipation(owner, name, discussion.number, user)
    if (found) matches.push(discussion.url)
  }

  const uniqueMatches = [...new Set(matches)]
  for (const url of uniqueMatches) {
    console.log(url)
  }
  console.log(`Total: ${uniqueMatches.length}`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
