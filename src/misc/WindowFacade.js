// @flow
import m from "mithril"
import {Mode, assertMainOrNodeBoot, isApp, isAndroidApp} from "../api/Env"
import {lang} from "./LanguageViewModel"
import type {WorkerClient} from "../api/main/WorkerClient"
import {asyncImport} from "../api/common/utils/Utils"
import {reloadNative} from "../native/SystemApp"
import {CloseEventBusOption} from "../api/common/TutanotaConstants"
import {nativeApp} from "../native/NativeWrapper";

assertMainOrNodeBoot()

export type KeyboardSizeListener = (keyboardSize: number) => mixed;

class WindowFacade {
	_windowSizeListeners: windowSizeListener[];
	resizeTimeout: ?TimeoutID;
	windowCloseConfirmation: boolean;
	_worker: WorkerClient;
	// following two properties are for the iOS
	_keyboardSize = 0;
	_keyboardSizeListeners: KeyboardSizeListener[] = [];

	constructor() {
		this._windowSizeListeners = []
		this.resizeTimeout = null
		this.windowCloseConfirmation = false
		this.init()
		asyncImport(typeof module !== "undefined" ? module.id : __moduleName,
			`${env.rootPathPrefix}src/api/main/WorkerClient.js`)
			.then(module => {
				// load async to reduce size of boot bundle
				this._worker = module.worker
				return nativeApp.initialized()
			}).then(() => this.addPageInBackgroundListener())
	}

	/**
	 * Add a window resize listener with a listenerId
	 * @param listener Provides the new width and height of the window if the values change.
	 */
	addResizeListener(listener: windowSizeListener) {
		this._windowSizeListeners.push(listener)
	}

	removeResizeListener(listener: windowSizeListener) {
		let index = this._windowSizeListeners.indexOf(listener)
		if (index > -1) {
			this._windowSizeListeners.splice(index, 1)
		}
	}

	addKeyboardSizeListener(listener: KeyboardSizeListener) {
		this._keyboardSizeListeners.push(listener);
		listener(this._keyboardSize);
	}

	removeKeyboardSizeListener(listener: KeyboardSizeListener) {
		const index = this._keyboardSizeListeners.indexOf(listener)
		if (index > -1) {
			this._keyboardSizeListeners.splice(index, 1)
		}
	}

	openLink(href: string): window {
		if (env.mode === Mode.App) {
			return window.open(href, "_system");
		} else {
			return window.open(href, "_blank");
		}
	}

	init() {
		window.onresize = (event) => {
			// see https://developer.mozilla.org/en-US/docs/Web/Events/resize
			// TODO (android >= 4.4) switch to requestAnimationFrame
			if (!this.resizeTimeout) {
				this.resizeTimeout = setTimeout(() => {
					this.resizeTimeout = null
					this._resize()
					// The actualResizeHandler will execute at a rate of 15fps
				}, 66)
			}
		}
		if (window.addEventListener && !isApp()) {
			window.addEventListener("beforeunload", e => this._beforeUnload(e))
			window.addEventListener("unload", e => this._onUnload())
		}
	}

	_resize() {
		//console.log("resize")
		try {
			for (let listener of this._windowSizeListeners) {
				listener(window.innerWidth, window.innerHeight)
			}
		} finally {
			m.redraw()
		}
	}

	checkWindowClosing(enable: boolean) {
		this.windowCloseConfirmation = enable
	}

	_beforeUnload(e: any) { // BeforeUnloadEvent
		if (this.windowCloseConfirmation) {
			let m = lang.get("closeWindowConfirmation_msg")
			e.returnValue = m
			return m
		} else {
			this._worker.logout(true)
		}
	}

	_onUnload() {
		if (this.windowCloseConfirmation) {
			this._worker.logout(true) // TODO investigate sendBeacon API as soon as it is widely supported (https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon)
		}
	}


	addOnlineListener(listener: Function) {
		window.addEventListener("online", listener)
	}

	addOfflineListener(listener: Function) {
		window.addEventListener("offline", listener)
	}

	/**
	 * Runs a setInterval and if more time than expected has passed we assume we resumed after suspend.
	 */
	addResumeAfterSuspendListener(listener: Function) {
		let CHECK_INTERVAL_SECONDS = 10
		let lastCheckTime = new Date().getTime()
		setInterval(() => {
			let newTime = new Date().getTime()
			// if more than 10 seconds more have passed we assume we resumed from suspend
			if ((newTime - lastCheckTime - CHECK_INTERVAL_SECONDS * 1000) > 10 * 1000) {
				listener()
			}
			lastCheckTime = newTime
		}, CHECK_INTERVAL_SECONDS * 1000)
	}

	reload(args: {[string]: any}) {
		if (isApp()) {
			if (!args.hasOwnProperty("noAutoLogin")) {
				args.noAutoLogin = true
			}
			let newQueryString = m.buildQueryString(args)
			reloadNative(newQueryString.length > 0 ? "?" + newQueryString : "")
		} else {
			window.location.reload();
		}
	}

	addPageInBackgroundListener() {
		if (isAndroidApp()) {
			document.addEventListener("visibilitychange", () => {
				console.log("Visibility change, hidden: ", document.hidden)
				if (document.hidden) {
					setTimeout(() => {
						// if we're still in background after timeout, pause WebSocket
						if (document.hidden) {
							this._worker.closeEventBus(CloseEventBusOption.Pause)
						}
					}, 30 * 1000)
				} else {
					this._worker.tryReconnectEventBus(false, true)
				}
			})
		}
	}

	onKeyboardSizeChanged(size: number) {
		this._keyboardSize = size;
		for (let listener of this._keyboardSizeListeners) {
			listener(size);
		}
		if (size > 0) {
			// reset position fixed for the body to allow scrolling in dialogs on iOS
			// https://github.com/scottjehl/Device-Bugs/issues/14
			const body = (document.body: any)
			body.style.position = 'unset'
			setTimeout(() => {
				body.style.position = 'fixed'
			}, 200)
		}
	}
}

export const windowFacade: WindowFacade = new WindowFacade()