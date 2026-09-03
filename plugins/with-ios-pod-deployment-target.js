const { withDangerousMod, withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const DEFAULT_IOS_DEPLOYMENT_TARGET = '15.1';
const MARKER = '# Timer: keep every CocoaPods target within the Xcode-supported iOS range.';

function withIosPodDeploymentTarget(config, props = {}) {
  const deploymentTarget = props.deploymentTarget || DEFAULT_IOS_DEPLOYMENT_TARGET;
  const appVersion = config.version;
  const iosBuildNumber = config.ios?.buildNumber;

  config = withXcodeProject(config, (modConfig) => {
    const buildConfigurations = modConfig.modResults.pbxXCBuildConfigurationSection();

    for (const buildConfiguration of Object.values(buildConfigurations || {})) {
      const buildSettings = buildConfiguration.buildSettings;
      if (!buildSettings || buildSettings.PRODUCT_NAME !== 'Timer') {
        continue;
      }

      if (appVersion) {
        buildSettings.MARKETING_VERSION = appVersion;
      }

      if (iosBuildNumber) {
        buildSettings.CURRENT_PROJECT_VERSION = iosBuildNumber;
      }
    }

    return modConfig;
  });

  return withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const podfilePath = path.join(modConfig.modRequest.platformProjectRoot, 'Podfile');
      let podfile = fs.readFileSync(podfilePath, 'utf8');

      if (!podfile.includes('minimum_ios_deployment_target =')) {
        podfile = podfile.replace(
          /podfile_properties = JSON\.parse\(File\.read\(File\.join\(__dir__, 'Podfile\.properties\.json'\)\)\) rescue \{\}/,
          `$&\nminimum_ios_deployment_target = podfile_properties['ios.deploymentTarget'] || '${deploymentTarget}'`
        );
      }

      podfile = podfile.replace(
        /platform :ios, podfile_properties\['ios\.deploymentTarget'\] \|\| '[^']+'/,
        'platform :ios, minimum_ios_deployment_target'
      );

      if (!podfile.includes(MARKER) && podfile.includes('installer.pods_project.targets.each do |target|')) {
        podfile = podfile.replace(
          /(\n\s+)installer\.pods_project\.targets\.each do \|target\|/,
          `$1${MARKER}$1installer.pods_project.targets.each do |target|`
        );
      }

      if (!podfile.includes(MARKER)) {
        podfile = podfile.replace(
          /(\s+react_native_post_install\([\s\S]*?\n\s{4}\)\n)(\s+end\nend\s*)$/,
          `$1\n    ${MARKER}\n    installer.pods_project.targets.each do |target|\n      target.build_configurations.each do |config|\n        current_target = config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']\n        next if current_target && Gem::Version.new(current_target) >= Gem::Version.new(minimum_ios_deployment_target)\n\n        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = minimum_ios_deployment_target\n      end\n    end\n$2`
        );
      }

      fs.writeFileSync(podfilePath, podfile);

      if (appVersion || iosBuildNumber) {
        const projectName = modConfig.modRequest.projectName;
        const xcodeProjectPath = path.join(
          modConfig.modRequest.platformProjectRoot,
          `${projectName}.xcodeproj`,
          'project.pbxproj'
        );
        let xcodeProject = fs.readFileSync(xcodeProjectPath, 'utf8');

        if (appVersion) {
          xcodeProject = xcodeProject.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${appVersion};`);
        }

        if (iosBuildNumber) {
          xcodeProject = xcodeProject.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${iosBuildNumber};`);
        }

        fs.writeFileSync(xcodeProjectPath, xcodeProject);
      }

      return modConfig;
    },
  ]);
}

module.exports = withIosPodDeploymentTarget;
