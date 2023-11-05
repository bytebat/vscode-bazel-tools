import * as vscode from 'vscode';
import * as path from 'path';
import * as api from './api';
import { logger } from './logging';
import { Utils } from './test_controller';

let extensionOutputChannel: vscode.OutputChannel | undefined;
let compileCommandsGenerator: vscode.Disposable | undefined;
let bazelTestCtrl: vscode.TestController | undefined;

const activeTestingSettingName = "activateTesting";
const activeTestingSettingDefault = true;
let testingActivated = false;

export async function activate(context: vscode.ExtensionContext) {
	extensionOutputChannel = vscode.window.createOutputChannel("vsc-bazel-tools");
	extensionOutputChannel.show();
	logger.attachTransport((logObj) => {
		extensionOutputChannel.appendLine(logObj['0'].toString());
	});

	let currentlyOpenTabFileDir = path.dirname(vscode.window.activeTextEditor?.document.uri.fsPath!);

	logger.info("Retrieving configuration.");
	const config = vscode.workspace.getConfiguration("vsc-bazel-tools");

	compileCommandsGenerator = vscode.commands.registerCommand('vsc-bazel-tools.generateCompileCommands', async () => {
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			cancellable: false,
			title: 'VSC Bazel Tools'
		}, async (progress) => {
			progress.report({ message: "Generating compile commands..." });

			await api.generateCompileCommands(currentlyOpenTabFileDir, config.get("customCompileCommandsTarget")).then(() => {
				logger.info(`Successfully generated compile commands!`);

				progress.report({
					message: "Successfully generated compile commands!"
				});
				//vscode.window.showInformationMessage(`Successfully generated compile commands!`);
			}).catch(
				error => {
					progress.report({ message: "Failed to generate compile commands!" });
					vscode.window.showErrorMessage(error.message);
				}
			);

			return new Promise<void>(resolve => {
				setTimeout(() => {
					resolve();
				}, 3000);
			});
		});
	});

	context.subscriptions.push(compileCommandsGenerator);

	// Set up testing API
	const toggleTestingFeature = async () => {
		if (!testingActivated) {
			bazelTestCtrl = vscode.tests.createTestController('bazelTestController', 'Unit tests');
			const utils = new Utils(bazelTestCtrl);

			bazelTestCtrl.resolveHandler = async test => {
				if (!test) {
					await utils.discoverAllTestsInWorkspace();
				} else {
					await utils.updateFromDisk(test);
				}
			};

			bazelTestCtrl.refreshHandler = async () => {
				await utils.discoverAllTestsInWorkspace();
			};

			// When text documents are open, parse tests in them.
			vscode.workspace.onDidOpenTextDocument(utils.updateFromDocument);
			// We could also listen to document changes to re-parse unsaved changes:
			vscode.workspace.onDidChangeTextDocument(e => utils.updateFromDocument(e.document));

			// Run profiles
			const runProfile = bazelTestCtrl.createRunProfile(
				'Run',
				vscode.TestRunProfileKind.Run,
				(request, token) => {
					utils.runHandler(false, request, token);
				}
			);

			const debugProfile = bazelTestCtrl.createRunProfile(
				'Debug',
				vscode.TestRunProfileKind.Debug,
				(request, token) => {
					utils.runHandler(true, request, token);
				}
			);

			context.subscriptions.push(bazelTestCtrl);
			testingActivated = true;
			logger.info("Testing feature activated!");
		} else {
			bazelTestCtrl?.dispose();
			testingActivated = false;
			logger.info("Testing feature deactivated!");
		}
	};

	// activate/deactivate testing feature initially
	if (config.get(activeTestingSettingName, activeTestingSettingDefault)) {
		await toggleTestingFeature();
	}

	// activate/deactivate testing feature on config change
	vscode.workspace.onDidChangeConfiguration(async e => {
		if (e.affectsConfiguration(`vsc-bazel-tools.${activeTestingSettingName}`) &&
			config.get(activeTestingSettingName, activeTestingSettingDefault) === true) {
			await toggleTestingFeature();
		}
	});
}

export function deactivate() {
	compileCommandsGenerator?.dispose();
	bazelTestCtrl?.dispose();
}
