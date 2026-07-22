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

export const WEBHOOK_UPDATE = /* GraphQL */ `
  mutation WebhookUpdate($id: String!, $input: WebhookUpdateInput!) {
    webhookUpdate(id: $id, input: $input) {
      success
      webhook { ${WEBHOOK_FIELDS} }
    }
  }
`;

export interface WebhookUpdateResult {
  webhookUpdate: { success: boolean; webhook: Webhook };
}

export const WEBHOOK_ROTATE_SECRET = /* GraphQL */ `
  mutation WebhookRotateSecret($id: String!) {
    webhookRotateSecret(id: $id) {
      success
      secret
    }
  }
`;

export interface WebhookRotateSecretResult {
  webhookRotateSecret: { success: boolean; secret: string };
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
  query Users($after: String, $includeArchived: Boolean, $filter: UserFilter) {
    users(first: 250, after: $after, includeArchived: $includeArchived, filter: $filter) {
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
  description: string | null;
  state: string;
  status: { id: string; name: string; type: string };
}

export interface Cycle {
  id: string;
  name: string | null;
  number: number;
  startsAt: string;
  endsAt: string;
  completedAt: string | null;
  isActive: boolean;
  isNext: boolean;
  isPast: boolean;
  isFuture: boolean;
  team: { id: string; key: string; name: string };
}

export interface IssueComment {
  id: string;
  body: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  user: { id: string; name: string; email: string } | null;
}

export interface IssueRelation {
  id: string;
  type: string;
  issue: { id: string; identifier: string; title: string };
  relatedIssue: { id: string; identifier: string; title: string };
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
  dueDate: string | null;
  estimate: number | null;
  team: { id: string; key: string; name: string };
  state: { id: string; name: string; type: string };
  assignee: { id: string; name: string; email: string } | null;
  labels: {
    nodes: Array<{ id: string; name: string; color: string }>;
  };
  project: { id: string; name: string } | null;
  parent: { id: string; identifier: string; title: string; url: string } | null;
  cycle: { id: string; name: string | null; number: number } | null;
  children: {
    nodes: Array<{ id: string; identifier: string; title: string }>;
  };
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
  dueDate
  estimate
  team { id key name }
  state { id name type }
  assignee { id name email }
  labels(first: 50) { nodes { id name color } }
  project { id name }
  parent { id identifier title url }
  cycle { id name number }
  children(first: 50) { nodes { id identifier title } }
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
  query IssueByIdentifier($teamKey: String!, $number: Float!, $includeArchived: Boolean) {
    issues(
      first: 2
      filter: { team: { key: { eq: $teamKey } }, number: { eq: $number } }
      includeArchived: $includeArchived
    ) {
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

export const SEARCH_ISSUES_QUERY = /* GraphQL */ `
  query SearchIssues(
    $term: String!
    $after: String
    $filter: IssueFilter
    $includeArchived: Boolean
    $teamId: String
    $includeComments: Boolean
  ) {
    searchIssues(
      first: 50
      after: $after
      term: $term
      filter: $filter
      includeArchived: $includeArchived
      teamId: $teamId
      includeComments: $includeComments
    ) {
      nodes { ${ISSUE_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export interface SearchIssuesResult {
  searchIssues: {
    nodes: IssueSummary[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

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

export const ISSUE_ARCHIVE = /* GraphQL */ `
  mutation IssueArchive($id: String!, $trash: Boolean) {
    issueArchive(id: $id, trash: $trash) {
      success
      entity {
        id
        identifier
        title
        url
      }
    }
  }
`;

export interface IssueArchiveResult {
  issueArchive: {
    success: boolean;
    entity: { id: string; identifier: string; title: string; url: string } | null;
  };
}

export const ISSUE_UNARCHIVE = /* GraphQL */ `
  mutation IssueUnarchive($id: String!) {
    issueUnarchive(id: $id) {
      success
      entity {
        id
        identifier
        title
        url
      }
    }
  }
`;

export interface IssueUnarchiveResult {
  issueUnarchive: {
    success: boolean;
    entity: { id: string; identifier: string; title: string; url: string } | null;
  };
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
        updatedAt
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
      updatedAt: string;
      user: { id: string; name: string; email: string } | null;
      issue: { id: string; identifier: string; title: string };
    };
  };
}

export const ISSUE_COMMENTS_QUERY = /* GraphQL */ `
  query IssueComments($id: String!, $after: String) {
    issue(id: $id) {
      id
      identifier
      comments(first: 50, after: $after) {
        nodes {
          id
          body
          url
          createdAt
          updatedAt
          user {
            id
            name
            email
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

export interface IssueCommentsResult {
  issue: {
    id: string;
    identifier: string;
    comments: {
      nodes: IssueComment[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  } | null;
}

const ISSUE_RELATION_NODE_FIELDS = /* GraphQL */ `
  id
  type
  issue {
    id
    identifier
    title
  }
  relatedIssue {
    id
    identifier
    title
  }
`;

export const ISSUE_OUTGOING_RELATIONS_QUERY = /* GraphQL */ `
  query IssueOutgoingRelations($id: String!, $after: String) {
    issue(id: $id) {
      id
      identifier
      relations(first: 50, after: $after) {
        nodes { ${ISSUE_RELATION_NODE_FIELDS} }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

export const ISSUE_INCOMING_RELATIONS_QUERY = /* GraphQL */ `
  query IssueIncomingRelations($id: String!, $after: String) {
    issue(id: $id) {
      id
      identifier
      inverseRelations(first: 50, after: $after) {
        nodes { ${ISSUE_RELATION_NODE_FIELDS} }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

export interface IssueOutgoingRelationsResult {
  issue: {
    id: string;
    identifier: string;
    relations: {
      nodes: IssueRelation[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  } | null;
}

export interface IssueIncomingRelationsResult {
  issue: {
    id: string;
    identifier: string;
    inverseRelations: {
      nodes: IssueRelation[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  } | null;
}

export const ISSUE_RELATION_CREATE = /* GraphQL */ `
  mutation IssueRelationCreate($input: IssueRelationCreateInput!) {
    issueRelationCreate(input: $input) {
      success
      issueRelation {
        id
        type
        issue {
          id
          identifier
          title
        }
        relatedIssue {
          id
          identifier
          title
        }
      }
    }
  }
`;

export interface IssueRelationCreateResult {
  issueRelationCreate: { success: boolean; issueRelation: IssueRelation };
}

export const ISSUE_RELATION_DELETE = /* GraphQL */ `
  mutation IssueRelationDelete($id: String!) {
    issueRelationDelete(id: $id) {
      success
    }
  }
`;

export interface IssueRelationDeleteResult {
  issueRelationDelete: { success: boolean };
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

const PROJECT_FIELDS = /* GraphQL */ `
  id
  name
  url
  description
  state
  status {
    id
    name
    type
  }
`;

export const PROJECTS_QUERY = /* GraphQL */ `
  query Projects($after: String, $filter: ProjectFilter, $includeArchived: Boolean) {
    projects(first: 50, after: $after, filter: $filter, includeArchived: $includeArchived) {
      nodes { ${PROJECT_FIELDS} }
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

export const PROJECT_BY_ID_QUERY = /* GraphQL */ `
  query ProjectById($id: String!) {
    project(id: $id) { ${PROJECT_FIELDS} }
  }
`;

export interface ProjectByIdResult {
  project: Project | null;
}

const CYCLE_FIELDS = /* GraphQL */ `
  id
  name
  number
  startsAt
  endsAt
  completedAt
  isActive
  isNext
  isPast
  isFuture
  team {
    id
    key
    name
  }
`;

export const CYCLES_QUERY = /* GraphQL */ `
  query Cycles($after: String, $filter: CycleFilter, $includeArchived: Boolean) {
    cycles(first: 50, after: $after, filter: $filter, includeArchived: $includeArchived) {
      nodes { ${CYCLE_FIELDS} }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export interface CyclesResult {
  cycles: {
    nodes: Cycle[];
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

export interface NotificationActor {
  id: string;
  name: string;
}

export interface Notification {
  id: string;
  type: string;
  category: string;
  title: string;
  subtitle: string;
  url: string;
  inboxUrl: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  readAt: string | null;
  snoozedUntilAt: string | null;
  actor: NotificationActor | null;
  issue?: { id: string; identifier: string; title: string } | null;
  project?: { id: string; name: string } | null;
  initiative?: { id: string; name: string } | null;
  documentId?: string | null;
  pullRequest?: { id: string; title: string; number: number; url: string } | null;
  comment?: { id: string; body: string } | null;
}

export interface NotificationSubscription {
  id: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  active: boolean;
  notificationSubscriptionTypes: string[];
  contextViewType: string | null;
  userContextViewType: string | null;
  subscriber: { id: string; name: string; email: string };
  team: { id: string; key: string; name: string } | null;
  project: { id: string; name: string } | null;
  cycle: { id: string; name: string | null; number: number } | null;
  label: { id: string; name: string } | null;
  initiative: { id: string; name: string } | null;
  customer: { id: string; name: string } | null;
  customView: { id: string; name: string } | null;
  user: { id: string; name: string; email: string } | null;
}

const NOTIFICATION_CORE_FIELDS = /* GraphQL */ `
  id
  type
  category
  title
  subtitle
  url
  inboxUrl
  createdAt
  updatedAt
  archivedAt
  readAt
  snoozedUntilAt
  actor {
    id
    name
  }
  ... on IssueNotification {
    issue {
      id
      identifier
      title
    }
  }
  ... on ProjectNotification {
    project {
      id
      name
    }
  }
  ... on InitiativeNotification {
    initiative {
      id
      name
    }
  }
  ... on DocumentNotification {
    documentId
  }
  ... on PullRequestNotification {
    pullRequest {
      id
      title
      number
      url
    }
  }
`;

/** Detail fields for get/mutations — include linked comment text when present. */
const NOTIFICATION_FIELDS = /* GraphQL */ `
  ${NOTIFICATION_CORE_FIELDS}
  ... on IssueNotification {
    comment {
      id
      body
    }
  }
  ... on ProjectNotification {
    comment {
      id
      body
    }
  }
`;

const NOTIFICATION_SUBSCRIPTION_FIELDS = /* GraphQL */ `
  id
  createdAt
  updatedAt
  archivedAt
  active
  contextViewType
  userContextViewType
  subscriber {
    id
    name
    email
  }
  team {
    id
    key
    name
  }
  project {
    id
    name
  }
  cycle {
    id
    name
    number
  }
  label {
    id
    name
  }
  initiative {
    id
    name
  }
  customer {
    id
    name
  }
  customView {
    id
    name
  }
  user {
    id
    name
    email
  }
  ... on TeamNotificationSubscription {
    notificationSubscriptionTypes
  }
  ... on ProjectNotificationSubscription {
    notificationSubscriptionTypes
  }
  ... on CycleNotificationSubscription {
    notificationSubscriptionTypes
  }
  ... on LabelNotificationSubscription {
    notificationSubscriptionTypes
  }
  ... on InitiativeNotificationSubscription {
    notificationSubscriptionTypes
  }
  ... on CustomerNotificationSubscription {
    notificationSubscriptionTypes
  }
  ... on CustomViewNotificationSubscription {
    notificationSubscriptionTypes
  }
  ... on UserNotificationSubscription {
    notificationSubscriptionTypes
  }
`;

export const NOTIFICATIONS_QUERY = /* GraphQL */ `
  query Notifications(
    $after: String
    $filter: NotificationFilter
    $includeArchived: Boolean
    $orderBy: PaginationOrderBy
  ) {
    notifications(
      first: 50
      after: $after
      filter: $filter
      includeArchived: $includeArchived
      orderBy: $orderBy
    ) {
      nodes { ${NOTIFICATION_FIELDS} }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export interface NotificationsResult {
  notifications: {
    nodes: Notification[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

export const NOTIFICATION_QUERY = /* GraphQL */ `
  query Notification($id: String!) {
    notification(id: $id) { ${NOTIFICATION_FIELDS} }
  }
`;

export interface NotificationResult {
  notification: Notification | null;
}

export const NOTIFICATIONS_UNREAD_COUNT_QUERY = /* GraphQL */ `
  query NotificationsUnreadCount {
    notificationsUnreadCount
  }
`;

export interface NotificationsUnreadCountResult {
  notificationsUnreadCount: number;
}

export const NOTIFICATION_SUBSCRIPTIONS_QUERY = /* GraphQL */ `
  query NotificationSubscriptions(
    $after: String
    $includeArchived: Boolean
    $orderBy: PaginationOrderBy
  ) {
    notificationSubscriptions(
      first: 50
      after: $after
      includeArchived: $includeArchived
      orderBy: $orderBy
    ) {
      nodes { ${NOTIFICATION_SUBSCRIPTION_FIELDS} }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export interface NotificationSubscriptionsResult {
  notificationSubscriptions: {
    nodes: NotificationSubscription[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

export const NOTIFICATION_SUBSCRIPTION_QUERY = /* GraphQL */ `
  query NotificationSubscription($id: String!) {
    notificationSubscription(id: $id) { ${NOTIFICATION_SUBSCRIPTION_FIELDS} }
  }
`;

export interface NotificationSubscriptionResult {
  notificationSubscription: NotificationSubscription | null;
}

export const NOTIFICATION_UPDATE = /* GraphQL */ `
  mutation NotificationUpdate($id: String!, $input: NotificationUpdateInput!) {
    notificationUpdate(id: $id, input: $input) {
      success
      notification { ${NOTIFICATION_FIELDS} }
    }
  }
`;

export interface NotificationUpdateResult {
  notificationUpdate: {
    success: boolean;
    notification: Notification;
  };
}

export const NOTIFICATION_MARK_READ_ALL = /* GraphQL */ `
  mutation NotificationMarkReadAll($input: NotificationEntityInput!, $readAt: DateTime!) {
    notificationMarkReadAll(input: $input, readAt: $readAt) {
      success
      notifications { ${NOTIFICATION_FIELDS} }
    }
  }
`;

export interface NotificationMarkReadAllResult {
  notificationMarkReadAll: {
    success: boolean;
    notifications: Notification[];
  };
}

export const NOTIFICATION_MARK_UNREAD_ALL = /* GraphQL */ `
  mutation NotificationMarkUnreadAll($input: NotificationEntityInput!) {
    notificationMarkUnreadAll(input: $input) {
      success
      notifications { ${NOTIFICATION_FIELDS} }
    }
  }
`;

export interface NotificationMarkUnreadAllResult {
  notificationMarkUnreadAll: {
    success: boolean;
    notifications: Notification[];
  };
}

export const NOTIFICATION_SNOOZE_ALL = /* GraphQL */ `
  mutation NotificationSnoozeAll($input: NotificationEntityInput!, $snoozedUntilAt: DateTime!) {
    notificationSnoozeAll(input: $input, snoozedUntilAt: $snoozedUntilAt) {
      success
      notifications { ${NOTIFICATION_FIELDS} }
    }
  }
`;

export interface NotificationSnoozeAllResult {
  notificationSnoozeAll: {
    success: boolean;
    notifications: Notification[];
  };
}

export const NOTIFICATION_UNSNOOZE_ALL = /* GraphQL */ `
  mutation NotificationUnsnoozeAll($input: NotificationEntityInput!, $unsnoozedAt: DateTime!) {
    notificationUnsnoozeAll(input: $input, unsnoozedAt: $unsnoozedAt) {
      success
      notifications { ${NOTIFICATION_FIELDS} }
    }
  }
`;

export interface NotificationUnsnoozeAllResult {
  notificationUnsnoozeAll: {
    success: boolean;
    notifications: Notification[];
  };
}

export const NOTIFICATION_ARCHIVE = /* GraphQL */ `
  mutation NotificationArchive($id: String!) {
    notificationArchive(id: $id) {
      success
      entity { ${NOTIFICATION_FIELDS} }
    }
  }
`;

export interface NotificationArchiveResult {
  notificationArchive: {
    success: boolean;
    entity: Notification | null;
  };
}

export const NOTIFICATION_ARCHIVE_ALL = /* GraphQL */ `
  mutation NotificationArchiveAll($input: NotificationEntityInput!) {
    notificationArchiveAll(input: $input) {
      success
      notifications { ${NOTIFICATION_FIELDS} }
    }
  }
`;

export interface NotificationArchiveAllResult {
  notificationArchiveAll: {
    success: boolean;
    notifications: Notification[];
  };
}

export const NOTIFICATION_UNARCHIVE = /* GraphQL */ `
  mutation NotificationUnarchive($id: String!) {
    notificationUnarchive(id: $id) {
      success
      entity { ${NOTIFICATION_FIELDS} }
    }
  }
`;

export interface NotificationUnarchiveResult {
  notificationUnarchive: {
    success: boolean;
    entity: Notification | null;
  };
}

export const NOTIFICATION_SUBSCRIPTION_CREATE = /* GraphQL */ `
  mutation NotificationSubscriptionCreate($input: NotificationSubscriptionCreateInput!) {
    notificationSubscriptionCreate(input: $input) {
      success
      notificationSubscription { ${NOTIFICATION_SUBSCRIPTION_FIELDS} }
    }
  }
`;

export interface NotificationSubscriptionCreateResult {
  notificationSubscriptionCreate: {
    success: boolean;
    notificationSubscription: NotificationSubscription;
  };
}

export const NOTIFICATION_SUBSCRIPTION_UPDATE = /* GraphQL */ `
  mutation NotificationSubscriptionUpdate(
    $id: String!
    $input: NotificationSubscriptionUpdateInput!
  ) {
    notificationSubscriptionUpdate(id: $id, input: $input) {
      success
      notificationSubscription { ${NOTIFICATION_SUBSCRIPTION_FIELDS} }
    }
  }
`;

export interface NotificationSubscriptionUpdateResult {
  notificationSubscriptionUpdate: {
    success: boolean;
    notificationSubscription: NotificationSubscription;
  };
}

export const NOTIFICATION_SUBSCRIPTION_DELETE = /* GraphQL */ `
  mutation NotificationSubscriptionDelete($id: String!) {
    notificationSubscriptionDelete(id: $id) {
      success
    }
  }
`;

export interface NotificationSubscriptionDeleteResult {
  notificationSubscriptionDelete: {
    success: boolean;
  };
}

/**
 * Build the preferences query from the canonical category/channel lists so
 * GraphQL selection sets cannot drift from CLI validation enums.
 */
export function buildUserNotificationPreferencesQuery(
  categories: readonly string[],
  channels: readonly string[],
): string {
  const channelFields = channels.join("\n        ");
  const categorySelections = categories
    .map((category) => `${category} { ${channelFields} }`)
    .join("\n        ");
  return /* GraphQL */ `
  query UserNotificationPreferences {
    userSettings {
      id
      notificationChannelPreferences {
        ${channelFields}
      }
      notificationCategoryPreferences {
        ${categorySelections}
      }
    }
  }
`;
}

export interface NotificationChannelPreferenceFlags {
  desktop: boolean;
  mobile: boolean;
  email: boolean;
  slack: boolean;
}

export interface UserNotificationPreferencesResult {
  userSettings: {
    id: string;
    notificationChannelPreferences: NotificationChannelPreferenceFlags;
    notificationCategoryPreferences: Record<string, NotificationChannelPreferenceFlags>;
  };
}

export const VIEWER_USER_QUERY = /* GraphQL */ `
  query ViewerUser {
    viewer {
      id
      name
      email
      active
      admin
      archivedAt
    }
  }
`;

export interface ViewerUserResult {
  viewer: User;
}

export const NOTIFICATION_CATEGORY_CHANNEL_UPDATE = /* GraphQL */ `
  mutation NotificationCategoryChannelSubscriptionUpdate(
    $channel: NotificationChannel!
    $category: NotificationCategory!
    $subscribe: Boolean!
  ) {
    notificationCategoryChannelSubscriptionUpdate(
      channel: $channel
      category: $category
      subscribe: $subscribe
    ) {
      success
    }
  }
`;

export interface NotificationCategoryChannelUpdateResult {
  notificationCategoryChannelSubscriptionUpdate: {
    success: boolean;
  };
}
