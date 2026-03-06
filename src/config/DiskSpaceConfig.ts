/**
 * Configuration for discovery disk space monitoring.
 *
 * Issue #1703: The discovery process creates significant temporary files
 * (Parquet chunks, merged data, binary training data). Without disk space
 * checks, operations fail with opaque I/O errors when the disk fills up.
 *
 * This config adds a configurable minimum free disk space threshold
 * below which discovery issues warnings or aborts gracefully.
 */

/**
 * Configuration for discovery disk space monitoring.
 *
 * All fields are optional; defaults are applied in `createNeatConfig()`.
 */
export interface DiskSpaceConfig {
  /**
   * Minimum free disk space (in MB) required before starting discovery.
   * When available disk space is below this threshold, a warning is logged.
   *
   * Defaults to 500 MB.
   */
  minFreeDiskMB?: number;

  /**
   * Critical free disk space threshold (in MB).
   * When available disk space falls below this value, discovery aborts
   * gracefully with a clear error message.
   *
   * Defaults to 100 MB.
   */
  criticalFreeDiskMB?: number;

  /**
   * Whether disk space monitoring is enabled.
   * When disabled, no disk space checks are performed.
   *
   * Defaults to true.
   */
  enabled?: boolean;
}

/**
 * Required version of DiskSpaceConfig with all fields populated.
 */
export type RequiredDiskSpaceConfig = Required<DiskSpaceConfig>;

/**
 * Default values for disk space monitoring configuration.
 */
export const DEFAULT_DISK_SPACE_CONFIG: RequiredDiskSpaceConfig = {
  minFreeDiskMB: 500,
  criticalFreeDiskMB: 100,
  enabled: true,
};
