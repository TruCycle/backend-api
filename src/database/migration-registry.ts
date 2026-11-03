import { PostgisExtensionMigration1700000000001 } from './migrations/1700000000001-CreatePostgisExtension';
import { CreateUuidExtension1700000000002 } from './migrations/1700000000002-CreateUuidExtension';
import { CreateUserKycAddress1700000000003 } from './migrations/1700000000003-CreateUserKycAddress';
import { CreateServiceZoneAndSeedLondon1700000000004 } from './migrations/1700000000004-CreateServiceZoneAndSeedLondon';
import { CreatePickupOrderAndItem1700000000005 } from './migrations/1700000000005-CreatePickupOrderAndItem';
import { AddPendingStatusAndUserNames1700000000006 } from './migrations/1700000000006-AddPendingStatusAndUserNames';
import { SetUserStatusDefaultPending1700000000007 } from './migrations/1700000000007-SetUserStatusDefaultPending';
import { CreateItemListing1700000000008 } from './migrations/1700000000008-CreateItemListing';
import { CreateClaimsTable1700000000009 } from './migrations/1700000000009-CreateClaimsTable';
import { AddClaimApprovedAt1700000000010 } from './migrations/1700000000010-AddClaimApprovedAt';
import { AddClaimCompletionAndScanEvents1700000000011 } from './migrations/1700000000011-AddClaimCompletionAndScanEvents';
import { AddUserProfileImageAndItemCo2AndReviews1700000000012 } from './migrations/1700000000012-AddUserProfileImageAndItemCo2AndReviews';
import { CreateMessagesTables1700000000013 } from './migrations/1700000000013-CreateMessagesTables';
import { AllowMultipleClaimsPerItem1700000000014 } from './migrations/1700000000014-AllowMultipleClaimsPerItem';
import { CreateShopTable1700000000015 } from './migrations/1700000000015-CreateShopTable';
import { ExtendShopContactHoursCategories1700000000016 } from './migrations/1700000000016-ExtendShopContactHoursCategories';
import { AddUserPostcode1700000000017 } from './migrations/1700000000017-AddUserPostcode';
import { AddShopOperationalNotes1700000000018 } from './migrations/1700000000018-AddShopOperationalNotes';
import { UniqueClaimPerCollectorPerItem1700000000019 } from './migrations/1700000000019-UniqueClaimPerCollectorPerItem';
import { CreateNotificationTable1700000000020 } from './migrations/1700000000020-CreateNotificationTable';
import { CreateWalletAndLedger1700000000021 } from './migrations/1700000000021-CreateWalletAndLedger';
import { AddApprovedCollectorIdToItemTable1700000000022 } from './migrations/1700000000022-AddApprovedCollectorIdToItemTable';
import { AddPasswordResetOtpToUser1700000000023 } from './migrations/1700000000023-AddPasswordResetOtpToUser';
import { CreateGamificationTables1700000000024 } from './migrations/1700000000024-CreateGamificationTables';
import { CreateFoundItemsTables1700000000025 } from './migrations/1700000000025-CreateFoundItemsTables';
import { EnhanceFoundItemsLocationAndImpact1700000000026 } from './migrations/1700000000026-EnhanceFoundItemsLocationAndImpact';
import { AddGoogleAuthToUser1700000000027 } from './migrations/1700000000027-AddGoogleAuthToUser';
import { FoundItemLifecycle1700000000028 } from './migrations/1700000000028-FoundItemLifecycle';
import { CreateAuthSessions1700000000029 } from './migrations/1700000000029-CreateAuthSessions';
import { CreateAuthRateCounters1700000000030 } from './migrations/1700000000030-CreateAuthRateCounters';

// Complete ordered history. Registration never authorises automatic execution.
export const migrationRegistry = [
  PostgisExtensionMigration1700000000001,
  CreateUuidExtension1700000000002,
  CreateUserKycAddress1700000000003,
  CreateServiceZoneAndSeedLondon1700000000004,
  CreatePickupOrderAndItem1700000000005,
  AddPendingStatusAndUserNames1700000000006,
  SetUserStatusDefaultPending1700000000007,
  CreateItemListing1700000000008,
  CreateClaimsTable1700000000009,
  AddClaimApprovedAt1700000000010,
  AddClaimCompletionAndScanEvents1700000000011,
  AddUserProfileImageAndItemCo2AndReviews1700000000012,
  CreateMessagesTables1700000000013,
  AllowMultipleClaimsPerItem1700000000014,
  CreateShopTable1700000000015,
  ExtendShopContactHoursCategories1700000000016,
  AddUserPostcode1700000000017,
  AddShopOperationalNotes1700000000018,
  UniqueClaimPerCollectorPerItem1700000000019,
  CreateNotificationTable1700000000020,
  CreateWalletAndLedger1700000000021,
  AddApprovedCollectorIdToItemTable1700000000022,
  AddPasswordResetOtpToUser1700000000023,
  CreateGamificationTables1700000000024,
  CreateFoundItemsTables1700000000025,
  EnhanceFoundItemsLocationAndImpact1700000000026,
  AddGoogleAuthToUser1700000000027,
  FoundItemLifecycle1700000000028,
  CreateAuthSessions1700000000029,
  CreateAuthRateCounters1700000000030,
];

export const registeredMigrationNames = migrationRegistry.map((migration) => migration.name);
