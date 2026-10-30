-- Bestehende Tokens stammen vom Expo Push Service und taugen für FCM nicht; die Apps melden FCM-Tokens neu an
DELETE FROM "push_token";
