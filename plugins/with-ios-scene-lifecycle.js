const { withDangerousMod, withInfoPlist, withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SCENE_DELEGATE_SOURCE = `import UIKit
import Expo
import React

public class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  public var window: UIWindow?

  public func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else {
      return
    }

    guard
      let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let factory = appDelegate.reactNativeFactory
    else {
      return
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window

    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: nil
    )
  }

  public func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let url = URLContexts.first?.url else {
      return
    }

    RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
  }

  public func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    RCTLinkingManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in }
    )
  }
}
`;

function patchAppDelegate(source) {
  return source.replace(
    /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\(\n\s*withModuleName: "main",\n\s*in: window,\n\s*launchOptions: launchOptions\)\n#endif\n/,
    '\n'
  );
}

function withIosSceneLifecycle(config) {
  config = withInfoPlist(config, (modConfig) => {
    modConfig.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };

    return modConfig;
  });

  config = withXcodeProject(config, (modConfig) => {
    const project = modConfig.modResults;
    const projectName = modConfig.modRequest.projectName;
    const sceneDelegatePath = `${projectName}/SceneDelegate.swift`;

    if (!project.hasFile(sceneDelegatePath)) {
      const groupKey = project.findPBXGroupKey({ name: projectName });
      const target = project.getFirstTarget().uuid;
      project.addSourceFile(sceneDelegatePath, { target }, groupKey);
    }

    return modConfig;
  });

  return withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const projectName = modConfig.modRequest.projectName;
      const projectRoot = modConfig.modRequest.platformProjectRoot;
      const sceneDelegatePath = path.join(projectRoot, projectName, 'SceneDelegate.swift');
      const appDelegatePath = path.join(projectRoot, projectName, 'AppDelegate.swift');

      fs.writeFileSync(sceneDelegatePath, SCENE_DELEGATE_SOURCE);
      fs.writeFileSync(appDelegatePath, patchAppDelegate(fs.readFileSync(appDelegatePath, 'utf8')));

      return modConfig;
    },
  ]);
}

module.exports = withIosSceneLifecycle;
