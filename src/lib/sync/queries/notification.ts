export const LIST_MY_NOTIFICATIONS = `
  query ListMyNotifications {
    listMyNotifications {
      notificationId
      workspaceId
      recipientMemberId
      kind
      source
      fromMemberId
      pageId
      blockId
      commentId
      previewBody
      workspaceName
      pageTitle
      read
      createdAt
    }
  }
`;

export const MARK_NOTIFICATION_READ = `
  mutation MarkNotificationRead($notificationId: ID!) {
    markNotificationRead(notificationId: $notificationId) {
      notificationId
      read
    }
  }
`;

export const DELETE_MY_NOTIFICATION = `
  mutation DeleteMyNotification($notificationId: ID!) {
    deleteMyNotification(notificationId: $notificationId)
  }
`;
