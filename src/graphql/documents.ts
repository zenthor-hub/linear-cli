export const VIEWER_QUERY = /* GraphQL */ `
  query Viewer {
    viewer {
      id
      name
      email
    }
    organization {
      id
      name
      urlKey
    }
  }
`;

export interface ViewerResult {
  viewer: { id: string; name: string; email: string };
  organization: { id: string; name: string; urlKey: string };
}

export interface Webhook {
  id: string;
  url: string;
  enabled: boolean;
  resourceTypes: string[];
  label: string | null;
  team: { id: string; name: string } | null;
  creator: { id: string; name: string } | null;
}

const WEBHOOK_FIELDS = /* GraphQL */ `
  id
  url
  enabled
  resourceTypes
  label
  team {
    id
    name
  }
  creator {
    id
    name
  }
`;

export const WEBHOOKS_QUERY = /* GraphQL */ `
  query Webhooks($after: String) {
    webhooks(first: 250, after: $after) {
      nodes { ${WEBHOOK_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export interface WebhooksResult {
  webhooks: {
    nodes: Webhook[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

export const WEBHOOK_QUERY = /* GraphQL */ `
  query Webhook($id: String!) {
    webhook(id: $id) { ${WEBHOOK_FIELDS} }
  }
`;

export interface WebhookResult {
  webhook: Webhook | null;
}

export const WEBHOOK_CREATE = /* GraphQL */ `
  mutation WebhookCreate($input: WebhookCreateInput!) {
    webhookCreate(input: $input) {
      success
      webhook { ${WEBHOOK_FIELDS} }
    }
  }
`;

export interface WebhookCreateResult {
  webhookCreate: { success: boolean; webhook: Webhook };
}

export const WEBHOOK_DELETE = /* GraphQL */ `
  mutation WebhookDelete($id: String!) {
    webhookDelete(id: $id) {
      success
    }
  }
`;

export interface WebhookDeleteResult {
  webhookDelete: { success: boolean };
}

export interface Team {
  id: string;
  key: string;
  name: string;
  private: boolean;
  archivedAt: string | null;
}

export const TEAMS_QUERY = /* GraphQL */ `
  query Teams($after: String, $includeArchived: Boolean) {
    teams(first: 250, after: $after, includeArchived: $includeArchived) {
      nodes {
        id
        key
        name
        private
        archivedAt
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export interface TeamsResult {
  teams: {
    nodes: Team[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

export interface User {
  id: string;
  name: string;
  email: string;
  active: boolean;
  admin: boolean;
  archivedAt: string | null;
}

export const USERS_QUERY = /* GraphQL */ `
  query Users($after: String, $includeArchived: Boolean) {
    users(first: 250, after: $after, includeArchived: $includeArchived) {
      nodes {
        id
        name
        email
        active
        admin
        archivedAt
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export interface UsersResult {
  users: {
    nodes: User[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

export interface IssueLabel {
  id: string;
  name: string;
  color: string;
  team: { id: string; key: string; name: string } | null;
}

export interface WorkflowState {
  id: string;
  name: string;
  type: string;
  position: number;
  team: { id: string; key: string; name: string };
}

export interface Project {
  id: string;
  name: string;
  url: string;
}

export interface IssueSummary {
  id: string;
  identifier: string;
  number: number;
  title: string;
  description: string | null;
  priority: number;
  priorityLabel: string;
  url: string;
  branchName: string;
  createdAt: string;
  updatedAt: string;
  team: { id: string; key: string; name: string };
  state: { id: string; name: string; type: string };
  assignee: { id: string; name: string; email: string } | null;
  labels: {
    nodes: Array<{ id: string; name: string; color: string }>;
  };
  project: { id: string; name: string } | null;
  parent: { id: string; identifier: string; title: string; url: string } | null;
}

const ISSUE_FIELDS = /* GraphQL */ `
  id
  identifier
  number
  title
  description
  priority
  priorityLabel
  url
  branchName
  createdAt
  updatedAt
  team { id key name }
  state { id name type }
  assignee { id name email }
  labels(first: 50) { nodes { id name color } }
  project { id name }
  parent { id identifier title url }
`;

export const ISSUE_BY_ID_QUERY = /* GraphQL */ `
  query IssueById($id: String!) {
    issue(id: $id) { ${ISSUE_FIELDS} }
  }
`;

export interface IssueByIdResult {
  issue: IssueSummary | null;
}

export const ISSUE_BY_IDENTIFIER_QUERY = /* GraphQL */ `
  query IssueByIdentifier($teamKey: String!, $number: Float!) {
    issues(first: 2, filter: { team: { key: { eq: $teamKey } }, number: { eq: $number } }) {
      nodes { ${ISSUE_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export interface IssuesResult {
  issues: {
    nodes: IssueSummary[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

export const ISSUES_QUERY = /* GraphQL */ `
  query Issues($after: String, $filter: IssueFilter, $includeArchived: Boolean) {
    issues(first: 50, after: $after, filter: $filter, includeArchived: $includeArchived) {
      nodes { ${ISSUE_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const ISSUE_UPDATE = /* GraphQL */ `
  mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
      issue { ${ISSUE_FIELDS} }
    }
  }
`;

export interface IssueUpdateResult {
  issueUpdate: { success: boolean; issue: IssueSummary };
}

export const ISSUE_CREATE = /* GraphQL */ `
  mutation IssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue { ${ISSUE_FIELDS} }
    }
  }
`;

export interface IssueCreateResult {
  issueCreate: { success: boolean; issue: IssueSummary };
}

export const COMMENT_CREATE = /* GraphQL */ `
  mutation CommentCreate($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success
      comment {
        id
        body
        url
        createdAt
        user {
          id
          name
          email
        }
        issue {
          id
          identifier
          title
        }
      }
    }
  }
`;

export interface CommentCreateResult {
  commentCreate: {
    success: boolean;
    comment: {
      id: string;
      body: string | null;
      url: string;
      createdAt: string;
      user: { id: string; name: string; email: string } | null;
      issue: { id: string; identifier: string; title: string };
    };
  };
}

export const WORKFLOW_STATES_QUERY = /* GraphQL */ `
  query WorkflowStates($after: String, $filter: WorkflowStateFilter) {
    workflowStates(first: 250, after: $after, filter: $filter) {
      nodes {
        id
        name
        type
        position
        team {
          id
          key
          name
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export interface WorkflowStatesResult {
  workflowStates: {
    nodes: WorkflowState[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

export const PROJECTS_QUERY = /* GraphQL */ `
  query Projects($after: String, $filter: ProjectFilter, $includeArchived: Boolean) {
    projects(first: 50, after: $after, filter: $filter, includeArchived: $includeArchived) {
      nodes {
        id
        name
        url
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export interface ProjectsResult {
  projects: {
    nodes: Project[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

export const ISSUE_LABELS_QUERY = /* GraphQL */ `
  query IssueLabels($after: String, $filter: IssueLabelFilter) {
    issueLabels(first: 250, after: $after, filter: $filter) {
      nodes {
        id
        name
        color
        team {
          id
          key
          name
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export interface IssueLabelsResult {
  issueLabels: {
    nodes: IssueLabel[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}
