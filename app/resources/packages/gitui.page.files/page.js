(function(jsxRuntime, React$1, reactDom) {
  "use strict";
  var _a, _b, _c;
  function _interopNamespaceDefault(e) {
    const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
    if (e) {
      for (const k in e) {
        if (k !== "default") {
          const d = Object.getOwnPropertyDescriptor(e, k);
          Object.defineProperty(n, k, d.get ? d : {
            enumerable: true,
            get: () => e[k]
          });
        }
      }
    }
    n.default = e;
    return Object.freeze(n);
  }
  const React__namespace = /* @__PURE__ */ _interopNamespaceDefault(React$1);
  function U() {
    const g = window.GITTER_UI;
    if (!g) throw new Error("GITTER_UI 未注入（外部页必须经宿主 pageLoader 装载）");
    return g;
  }
  const BOOT = ((_b = (_a = window.GITTER_UI) == null ? void 0 : _a.getActiveCaller) == null ? void 0 : _b.call(_a)) ?? null;
  (() => {
    var _a2, _b2;
    try {
      return ((_b2 = (_a2 = window.GITTER_UI) == null ? void 0 : _a2.pageDocs) == null ? void 0 : _b2.call(_a2)) ?? null;
    } catch {
      return null;
    }
  })();
  const pageSdk = {
    call: (method, params) => {
      const g = U();
      return BOOT ? g.callWith(BOOT, method, params) : g.call(method, params);
    },
    on: (method, cb) => U().on(method, cb),
    t: (key, ...args) => U().t(key, ...args),
    navigate: (page) => U().navigate(page),
    taskPanels: () => [],
    requestFileFocus: (path) => U().requestFileFocus(path),
    openSettings: (section) => U().openSettings(section),
    toast: (title, body) => U().toast(title, body),
    refresh: () => U().refresh(),
    notifyRepoChanged: () => U().notifyRepoChanged(),
    repo: () => U().repo(),
    pathForFile: (file) => {
      try {
        return U().pathForFile(file);
      } catch {
        return "";
      }
    },
    settings: () => U().settings(),
    theme: () => U().theme(),
    openRepo: (path) => U().openRepo(path),
    closeRepo: () => U().closeRepo(),
    updateSettings: (patch) => U().updateSettings(patch),
    applySettings: (s) => U().applySettings(s),
    reloadTheme: () => U().reloadTheme(),
    clearSettingsFocus: () => U().clearSettingsFocus(),
    context: () => U().context(),
    setContext: (...a) => U().setContext(...a),
    focusTask: (taskId) => U().focusTask(taskId),
    clearTaskFocus: () => U().clearTaskFocus(),
    runCommand: (cmd, ctx) => U().runCommand(cmd, ctx),
    extTree: () => U().extTree(),
    registerDoc: (def) => U().registerDoc(def),
    docs: () => U().docs(),
    onDocsChanged: (cb) => U().onDocsChanged(cb),
    docsVersion: () => U().docsVersion()
  };
  function useAppState() {
    const g = U();
    return React$1.useSyncExternalStore(g.subscribeState, g.getState);
  }
  function getMeasurementKey(item) {
    return typeof item === "object" ? item.key : item;
  }
  function createLazyMeasurementsView(cache, flat) {
    const count = cache.length;
    return new Proxy(cache, {
      get(target, prop, receiver) {
        if (typeof prop === "string") {
          const c = prop.charCodeAt(0);
          if (c >= 48 && c <= 57) {
            const i = +prop;
            if (Number.isInteger(i) && i >= 0 && i < count) {
              let v = target[i];
              if (typeof v !== "object") {
                const s = flat[i * 2];
                v = target[i] = {
                  index: i,
                  key: v,
                  start: s,
                  size: flat[i * 2 + 1],
                  end: s + flat[i * 2 + 1],
                  lane: 0
                };
              }
              return v;
            }
          }
          if (prop === "length") return count;
        }
        return Reflect.get(target, prop, receiver);
      }
    });
  }
  function memo(getDeps, fn, opts) {
    let deps = opts.initialDeps ?? [];
    let result;
    let isInitial = true;
    function memoizedFunction() {
      const newDeps = getDeps();
      const depsChanged = newDeps.length !== deps.length || newDeps.some((dep, index) => deps[index] !== dep);
      if (!depsChanged) {
        return result;
      }
      deps = newDeps;
      result = fn(...newDeps);
      if ((opts == null ? void 0 : opts.onChange) && !(isInitial && opts.skipInitialOnChange)) {
        opts.onChange(result);
      }
      isInitial = false;
      return result;
    }
    memoizedFunction.updateDeps = (newDeps) => {
      deps = newDeps;
    };
    return memoizedFunction;
  }
  function notUndefined(value, msg) {
    if (value === void 0) {
      throw new Error(`Unexpected undefined${""}`);
    } else {
      return value;
    }
  }
  const approxEqual = (a, b) => Math.abs(a - b) < 1.01;
  const debounce = (targetWindow, fn, ms) => {
    let timeoutId;
    return Object.assign(
      function(...args) {
        targetWindow.clearTimeout(timeoutId);
        timeoutId = targetWindow.setTimeout(() => fn.apply(this, args), ms);
      },
      {
        // The handle is closure-local, so a caller that has already
        // unsubscribed has no way to stop a queued call. Teardown paths use
        // this to drop the pending invocation instead of letting it land.
        cancel: () => {
          targetWindow.clearTimeout(timeoutId);
        }
      }
    );
  };
  let _isIOSResult;
  const isIOSWebKit = () => {
    if (_isIOSResult !== void 0) return _isIOSResult;
    if (typeof navigator === "undefined") return _isIOSResult = false;
    if (/iP(hone|od|ad)/.test(navigator.userAgent)) return _isIOSResult = true;
    const mtp = navigator.maxTouchPoints;
    return _isIOSResult = navigator.platform === "MacIntel" && mtp !== void 0 && mtp > 0;
  };
  const getRect = (element) => {
    const { offsetWidth, offsetHeight } = element;
    return { width: offsetWidth, height: offsetHeight };
  };
  const defaultKeyExtractor = (index) => index;
  const defaultRangeExtractor = (range) => {
    const start = Math.max(range.startIndex - range.overscan, 0);
    const end = Math.min(range.endIndex + range.overscan, range.count - 1);
    const len = end - start + 1;
    const arr = new Array(len);
    for (let i = 0; i < len; i++) {
      arr[i] = start + i;
    }
    return arr;
  };
  const observeElementRect = (instance, cb) => {
    const element = instance.scrollElement;
    if (!element) {
      return;
    }
    const targetWindow = instance.targetWindow;
    if (!targetWindow) {
      return;
    }
    const handler = (rect) => {
      const { width, height } = rect;
      cb({ width: Math.round(width), height: Math.round(height) });
    };
    handler(getRect(element));
    if (!targetWindow.ResizeObserver) {
      return () => {
      };
    }
    const observer = new targetWindow.ResizeObserver((entries) => {
      const run = () => {
        const entry = entries[0];
        if (entry == null ? void 0 : entry.borderBoxSize) {
          const box = entry.borderBoxSize[0];
          if (box) {
            handler({ width: box.inlineSize, height: box.blockSize });
            return;
          }
        }
        handler(getRect(element));
      };
      instance.options.useAnimationFrameWithResizeObserver ? requestAnimationFrame(run) : run();
    });
    observer.observe(element, { box: "border-box" });
    return () => {
      observer.unobserve(element);
    };
  };
  const addEventListenerOptions = {
    passive: true
  };
  const supportsScrollend = typeof window == "undefined" ? true : "onscrollend" in window;
  const observeOffset = (instance, cb, readOffset) => {
    const element = instance.scrollElement;
    if (!element) {
      return;
    }
    const targetWindow = instance.targetWindow;
    if (!targetWindow) {
      return;
    }
    const registerScrollendEvent = instance.options.useScrollendEvent && supportsScrollend;
    let offset = 0;
    const fallback = registerScrollendEvent ? null : debounce(
      targetWindow,
      () => cb(readOffset(element), false),
      instance.options.isScrollingResetDelay
    );
    const createHandler = (isScrolling) => () => {
      offset = readOffset(element);
      fallback == null ? void 0 : fallback();
      cb(offset, isScrolling);
    };
    const handler = createHandler(true);
    const endHandler = createHandler(false);
    element.addEventListener("scroll", handler, addEventListenerOptions);
    if (registerScrollendEvent) {
      element.addEventListener("scrollend", endHandler, addEventListenerOptions);
    }
    return () => {
      element.removeEventListener("scroll", handler);
      if (registerScrollendEvent) {
        element.removeEventListener("scrollend", endHandler);
      }
      fallback == null ? void 0 : fallback.cancel();
    };
  };
  const observeElementOffset = (instance, cb) => observeOffset(instance, cb, (el) => {
    const { horizontal, isRtl } = instance.options;
    return horizontal ? el.scrollLeft * (isRtl && -1 || 1) : el.scrollTop;
  });
  const measureElement = (element, entry, instance) => {
    if (instance.options.useCachedMeasurements) {
      const index = instance.indexFromElement(element);
      const key = instance.options.getItemKey(index);
      return instance.itemSizeCache.get(key) ?? instance.options.estimateSize(index);
    }
    if (entry == null ? void 0 : entry.borderBoxSize) {
      const box = entry.borderBoxSize[0];
      if (box) {
        const size = Math.round(
          box[instance.options.horizontal ? "inlineSize" : "blockSize"]
        );
        return size;
      }
    }
    if (!entry) {
      const index = instance.indexFromElement(element);
      const key = instance.options.getItemKey(index);
      const cachedSize = instance.itemSizeCache.get(key);
      if (cachedSize !== void 0) {
        return cachedSize;
      }
    }
    return element[instance.options.horizontal ? "offsetWidth" : "offsetHeight"];
  };
  const scrollWithAdjustments = (offset, {
    adjustments = 0,
    behavior
  }, instance) => {
    var _a2, _b2;
    (_b2 = (_a2 = instance.scrollElement) == null ? void 0 : _a2.scrollTo) == null ? void 0 : _b2.call(_a2, {
      [instance.options.horizontal ? "left" : "top"]: offset + adjustments,
      behavior
    });
  };
  const elementScroll = scrollWithAdjustments;
  function isAppendWithTrim(prevCount, nextCount, getPreviousKey, getNextKey) {
    if (nextCount === 0) return false;
    const firstKey = getNextKey(0);
    const removedKeys = /* @__PURE__ */ new Set();
    let removedCount = 0;
    while (removedCount < prevCount) {
      const key = getPreviousKey(removedCount);
      if (key === firstKey) break;
      removedKeys.add(key);
      removedCount++;
    }
    const retainedCount = prevCount - removedCount;
    if (retainedCount === 0 || retainedCount >= nextCount) return false;
    for (let i = 0; i < retainedCount; i++) {
      if (getNextKey(i) !== getPreviousKey(removedCount + i)) return false;
    }
    for (let i = retainedCount; i < nextCount; i++) {
      if (removedKeys.has(getNextKey(i))) return false;
    }
    return true;
  }
  class Virtualizer {
    constructor(opts) {
      this.unsubs = [];
      this.scrollElement = null;
      this.targetWindow = null;
      this.isScrolling = false;
      this.scrollState = null;
      this.measurementsCache = [];
      this._singleLaneMeasurements = null;
      this.itemSizeCache = /* @__PURE__ */ new Map();
      this.itemSizeCacheVersion = 0;
      this.laneAssignments = /* @__PURE__ */ new Map();
      this.pendingMin = null;
      this.prevLanes = void 0;
      this.lanesChangedFlag = false;
      this.lanesSettling = false;
      this.pendingScrollAnchor = null;
      this.scrollRect = null;
      this.scrollOffset = null;
      this.scrollDirection = null;
      this.scrollAdjustments = 0;
      this._iosDeferredAdjustment = 0;
      this._iosTouching = false;
      this._iosJustTouchEnded = false;
      this._iosTouchEndTimerId = null;
      this._intendedScrollOffset = null;
      this._clampedAdjustment = null;
      this.elementsCache = /* @__PURE__ */ new Map();
      this.now = () => {
        var _a2, _b2, _c2;
        return ((_c2 = (_b2 = (_a2 = this.targetWindow) == null ? void 0 : _a2.performance) == null ? void 0 : _b2.now) == null ? void 0 : _c2.call(_b2)) ?? Date.now();
      };
      this.observer = /* @__PURE__ */ (() => {
        let _ro = null;
        const get = () => {
          if (_ro) {
            return _ro;
          }
          if (!this.targetWindow || !this.targetWindow.ResizeObserver) {
            return null;
          }
          return _ro = new this.targetWindow.ResizeObserver((entries) => {
            entries.forEach((entry) => {
              const run = () => {
                const node = entry.target;
                const index = this.indexFromElement(node);
                if (!node.isConnected) {
                  this.observer.unobserve(node);
                  for (const [cacheKey, cachedNode] of this.elementsCache) {
                    if (cachedNode === node) {
                      this.elementsCache.delete(cacheKey);
                      break;
                    }
                  }
                  return;
                }
                if (!this.isIndexInRange(index)) return;
                if (this.shouldMeasureDuringScroll(index)) {
                  this.resizeItem(
                    index,
                    this.options.measureElement(node, entry, this)
                  );
                }
              };
              this.options.useAnimationFrameWithResizeObserver ? requestAnimationFrame(run) : run();
            });
          });
        };
        return {
          disconnect: () => {
            var _a2;
            (_a2 = get()) == null ? void 0 : _a2.disconnect();
            _ro = null;
          },
          observe: (target) => {
            var _a2;
            return (_a2 = get()) == null ? void 0 : _a2.observe(target, { box: "border-box" });
          },
          unobserve: (target) => {
            var _a2;
            return (_a2 = get()) == null ? void 0 : _a2.unobserve(target);
          }
        };
      })();
      this.range = null;
      this.setOptions = (opts2) => {
        var _a2;
        const merged = {
          debug: false,
          initialOffset: 0,
          overscan: 1,
          paddingStart: 0,
          paddingEnd: 0,
          scrollPaddingStart: 0,
          scrollPaddingEnd: 0,
          horizontal: false,
          getItemKey: defaultKeyExtractor,
          rangeExtractor: defaultRangeExtractor,
          onChange: () => {
          },
          measureElement,
          initialRect: { width: 0, height: 0 },
          scrollMargin: 0,
          gap: 0,
          indexAttribute: "data-index",
          initialMeasurementsCache: [],
          lanes: 1,
          anchorTo: "start",
          followOnAppend: false,
          scrollEndThreshold: 1,
          isScrollingResetDelay: 150,
          enabled: true,
          isRtl: false,
          useScrollendEvent: false,
          useAnimationFrameWithResizeObserver: false,
          laneAssignmentMode: "estimate",
          useCachedMeasurements: false
        };
        for (const key in opts2) {
          const v = opts2[key];
          if (v !== void 0) merged[key] = v;
        }
        const prevOptions = this.options;
        let anchor = null;
        let followOnAppend = null;
        let edgeKeysChanged = false;
        if (prevOptions !== void 0 && prevOptions.enabled && merged.enabled && merged.anchorTo === "end" && this.scrollElement !== null) {
          const prevCount = prevOptions.count;
          const nextCount = merged.count;
          const measurements = this.getMeasurements();
          const previousItems = ((_a2 = this._singleLaneMeasurements) == null ? void 0 : _a2.items) ?? measurements;
          const getPreviousKey = (index) => getMeasurementKey(previousItems[index]);
          const prevFirstKey = prevCount > 0 ? getPreviousKey(0) : null;
          const prevLastKey = prevCount > 0 ? getPreviousKey(prevCount - 1) : null;
          const didCountChange = nextCount !== prevCount;
          const didEdgeKeysChange = didCountChange || prevCount > 0 && nextCount > 0 && (merged.getItemKey(0) !== prevFirstKey || merged.getItemKey(nextCount - 1) !== prevLastKey);
          if (didEdgeKeysChange) {
            edgeKeysChanged = true;
            const item = prevCount > 0 ? this.getVirtualItemForOffset(this.getScrollOffset()) ?? measurements[0] : null;
            if (item) {
              anchor = [item.key, this.getScrollOffset() - item.start];
            }
            const behavior = merged.followOnAppend === true ? "auto" : merged.followOnAppend || null;
            if (behavior && nextCount > 0 && this.isAtEnd(prevOptions.scrollEndThreshold) && (prevCount === 0 || merged.getItemKey(nextCount - 1) !== prevLastKey)) {
              if (nextCount > prevCount || isAppendWithTrim(
                prevCount,
                nextCount,
                getPreviousKey,
                merged.getItemKey
              )) {
                followOnAppend = behavior;
              }
            }
          }
        }
        this.options = merged;
        if (edgeKeysChanged) {
          this.pendingMin = 0;
          this.itemSizeCacheVersion++;
        }
        let anchorResolved = false;
        let anchorDelta = 0;
        if (anchor && this.scrollOffset !== null) {
          const [anchorKey, anchorOffset] = anchor;
          const newMeasurements = this.getMeasurements();
          const { count, getItemKey } = this.options;
          let idx = 0;
          while (idx < count && getItemKey(idx) !== anchorKey) {
            idx++;
          }
          if (idx < count) {
            const anchorItem = newMeasurements[idx];
            if (anchorItem) {
              const newOffset = Math.max(0, anchorItem.start + anchorOffset);
              if (!followOnAppend && newOffset !== this.scrollOffset) {
                anchorDelta = newOffset - this.scrollOffset;
                this.scrollOffset = newOffset;
                anchorResolved = true;
              }
            }
          }
        }
        if (anchorResolved || followOnAppend) {
          this.pendingScrollAnchor = [
            anchorResolved ? anchor[0] : null,
            anchorResolved ? anchor[1] : 0,
            followOnAppend,
            anchorDelta
          ];
        }
      };
      this.notify = (sync) => {
        var _a2, _b2;
        (_b2 = (_a2 = this.options).onChange) == null ? void 0 : _b2.call(_a2, this, sync);
      };
      this.maybeNotify = memo(
        () => {
          this.calculateRange();
          return [
            this.isScrolling,
            this.range ? this.range.startIndex : null,
            this.range ? this.range.endIndex : null
          ];
        },
        (isScrolling) => {
          this.notify(isScrolling);
        },
        {
          key: false,
          debug: () => this.options.debug,
          initialDeps: [
            this.isScrolling,
            this.range ? this.range.startIndex : null,
            this.range ? this.range.endIndex : null
          ]
        }
      );
      this.cleanup = () => {
        this.unsubs.filter(Boolean).forEach((d) => d());
        this.unsubs = [];
        this.observer.disconnect();
        if (this.rafId != null && this.targetWindow) {
          this.targetWindow.cancelAnimationFrame(this.rafId);
          this.rafId = null;
        }
        this.scrollState = null;
        this.isScrolling = false;
        this.scrollDirection = null;
        this._iosDeferredAdjustment = 0;
        this._iosTouching = false;
        this._iosJustTouchEnded = false;
        this._clampedAdjustment = null;
        this.scrollElement = null;
        this.targetWindow = null;
      };
      this._didMount = () => {
        return () => {
          this.cleanup();
        };
      };
      this._willUpdate = () => {
        var _a2, _b2;
        const scrollElement = this.options.enabled ? this.options.getScrollElement() : null;
        if (this.scrollElement !== scrollElement) {
          this.cleanup();
          if (!scrollElement) {
            this.maybeNotify();
            return;
          }
          this.scrollElement = scrollElement;
          if (this.scrollElement && "ownerDocument" in this.scrollElement) {
            this.targetWindow = this.scrollElement.ownerDocument.defaultView;
          } else {
            this.targetWindow = ((_a2 = this.scrollElement) == null ? void 0 : _a2.window) ?? null;
          }
          this.elementsCache.forEach((cached) => {
            this.observer.observe(cached);
          });
          this.unsubs.push(
            this.options.observeElementRect(this, (rect) => {
              this.scrollRect = rect;
              this.maybeNotify();
            })
          );
          this.unsubs.push(
            this.options.observeElementOffset(this, (offset, isScrolling) => {
              if (isScrolling && this._intendedScrollOffset === null && offset === this.scrollOffset) {
                return;
              }
              if (this._intendedScrollOffset !== null && Math.abs(offset - this._intendedScrollOffset) < 1.5) {
                offset = this._intendedScrollOffset;
              }
              this._intendedScrollOffset = null;
              if (this._clampedAdjustment !== null && Math.abs(offset - this._clampedAdjustment.maxAtWrite) >= 1.5) {
                this._clampedAdjustment = null;
              }
              this.scrollAdjustments = 0;
              const prevOffset = this.getScrollOffset();
              this.scrollDirection = isScrolling ? prevOffset === offset ? this.scrollDirection : prevOffset < offset ? "forward" : "backward" : null;
              this.scrollOffset = offset;
              this.isScrolling = isScrolling;
              this._flushIosDeferredIfReady();
              if (this.scrollState) {
                this.scheduleScrollReconcile();
              }
              this.maybeNotify();
            })
          );
          if ("addEventListener" in this.scrollElement) {
            const scrollEl = this.scrollElement;
            const onTouchStart = () => {
              this._iosTouching = true;
              this._iosJustTouchEnded = false;
              if (this._iosTouchEndTimerId !== null && this.targetWindow != null) {
                this.targetWindow.clearTimeout(this._iosTouchEndTimerId);
                this._iosTouchEndTimerId = null;
              }
            };
            const onTouchEnd = () => {
              this._iosTouching = false;
              if (!isIOSWebKit() || this.targetWindow == null) {
                return;
              }
              this._iosJustTouchEnded = true;
              this._iosTouchEndTimerId = this.targetWindow.setTimeout(() => {
                this._iosJustTouchEnded = false;
                this._iosTouchEndTimerId = null;
                this._flushIosDeferredIfReady();
              }, 150);
            };
            scrollEl.addEventListener(
              "touchstart",
              onTouchStart,
              addEventListenerOptions
            );
            scrollEl.addEventListener(
              "touchend",
              onTouchEnd,
              addEventListenerOptions
            );
            this.unsubs.push(() => {
              scrollEl.removeEventListener("touchstart", onTouchStart);
              scrollEl.removeEventListener("touchend", onTouchEnd);
              if (this._iosTouchEndTimerId !== null && this.targetWindow != null) {
                this.targetWindow.clearTimeout(this._iosTouchEndTimerId);
                this._iosTouchEndTimerId = null;
              }
            });
          }
          this._scrollToOffset(this.getScrollOffset(), {
            adjustments: void 0,
            behavior: void 0
          });
        }
        const anchor = this.pendingScrollAnchor;
        this.pendingScrollAnchor = null;
        if (anchor && this.scrollElement && this.options.enabled) {
          const [key, _offset, followOnAppend, anchorDelta] = anchor;
          if (key !== null && !followOnAppend) {
            if (isIOSWebKit() && (this.isScrolling || this._iosTouching || this._iosJustTouchEnded)) {
              if (anchorDelta !== 0) {
                this._iosDeferredAdjustment += anchorDelta;
              }
            } else if (((_b2 = this.scrollState) == null ? void 0 : _b2.behavior) === "smooth" && !approxEqual(
              this.getScrollOffset() - anchorDelta,
              this.scrollState.lastTargetOffset
            )) ;
            else {
              this._scrollToOffset(this.getScrollOffset(), {
                adjustments: void 0,
                behavior: void 0
              });
            }
          }
          if (followOnAppend) {
            this.scrollToEnd({ behavior: followOnAppend });
          }
        }
        this._retryClampedAdjustment();
      };
      this._retryClampedAdjustment = () => {
        if (this._clampedAdjustment === null || !this.scrollElement || !this.options.enabled) {
          return;
        }
        const { target, maxAtWrite } = this._clampedAdjustment;
        const max = this.getMaxScrollOffset();
        if (max > maxAtWrite + 0.5) {
          this._clampedAdjustment = target > max + 0.5 ? { target, maxAtWrite: max } : null;
          this._scrollToOffset(target, {
            adjustments: void 0,
            behavior: void 0
          });
        }
      };
      this._flushIosDeferredIfReady = () => {
        if (this._iosDeferredAdjustment === 0) return;
        if (this.isScrolling) return;
        if (this._iosTouching) return;
        if (this._iosJustTouchEnded) return;
        const cur = this.getScrollOffset();
        const max = this.getMaxScrollOffset();
        if (cur < 0 || cur > max) return;
        if (this._iosDeferredAdjustment < 0 && cur >= max - 1) {
          this._iosDeferredAdjustment = 0;
          return;
        }
        const delta = this._iosDeferredAdjustment;
        this._iosDeferredAdjustment = 0;
        this._scrollToOffset(cur, {
          adjustments: this.scrollAdjustments += delta,
          behavior: void 0
        });
      };
      this.rafId = null;
      this.getSize = () => {
        if (!this.options.enabled) {
          this.scrollRect = null;
          return 0;
        }
        this.scrollRect = this.scrollRect ?? this.options.initialRect;
        return this.scrollRect[this.options.horizontal ? "width" : "height"];
      };
      this.getScrollOffset = () => {
        if (!this.options.enabled) {
          this.scrollOffset = null;
          return 0;
        }
        this.scrollOffset = this.scrollOffset ?? (typeof this.options.initialOffset === "function" ? this.options.initialOffset() : this.options.initialOffset);
        return this.scrollOffset;
      };
      this.getMeasurementOptions = memo(
        () => [
          this.options.count,
          this.options.paddingStart,
          this.options.scrollMargin,
          this.options.getItemKey,
          this.options.enabled,
          this.options.lanes,
          this.options.laneAssignmentMode,
          this.options.gap
        ],
        (count, paddingStart, scrollMargin, getItemKey, enabled, lanes, laneAssignmentMode, gap) => {
          const lanesChanged = this.prevLanes !== void 0 && this.prevLanes !== lanes;
          if (lanesChanged) {
            this.lanesChangedFlag = true;
          }
          this.prevLanes = lanes;
          this.pendingMin = null;
          return {
            count,
            paddingStart,
            scrollMargin,
            getItemKey,
            enabled,
            lanes,
            laneAssignmentMode,
            gap
          };
        },
        {
          key: false
        }
      );
      this.isIndexInRange = (index) => index >= 0 && index < this.options.count;
      this.getMeasurements = memo(
        () => [this.getMeasurementOptions(), this.itemSizeCacheVersion],
        ({
          count,
          paddingStart,
          scrollMargin,
          getItemKey,
          enabled,
          lanes,
          laneAssignmentMode,
          gap
        }, _itemSizeCacheVersion) => {
          var _a2;
          const itemSizeCache = this.itemSizeCache;
          if (!enabled) {
            this.measurementsCache = [];
            this._singleLaneMeasurements = null;
            this.itemSizeCache.clear();
            this.laneAssignments.clear();
            return [];
          }
          if (this.laneAssignments.size > count) {
            for (const index of this.laneAssignments.keys()) {
              if (index >= count) {
                this.laneAssignments.delete(index);
              }
            }
          }
          if (this.lanesChangedFlag) {
            this.lanesChangedFlag = false;
            this.lanesSettling = true;
            this.measurementsCache = [];
            this._singleLaneMeasurements = null;
            this.itemSizeCache.clear();
            this.laneAssignments.clear();
            this.pendingMin = null;
          }
          if (this.measurementsCache.length === 0 && !this.lanesSettling) {
            this.measurementsCache = this.options.initialMeasurementsCache;
            this.measurementsCache.forEach((item) => {
              this.itemSizeCache.set(item.key, item.size);
            });
          }
          const min = this.lanesSettling ? 0 : this.pendingMin ?? 0;
          this.pendingMin = null;
          if (this.lanesSettling && this.measurementsCache.length === count) {
            this.lanesSettling = false;
          }
          if (lanes === 1) {
            const need = count * 2;
            let flat = (_a2 = this._singleLaneMeasurements) == null ? void 0 : _a2.flat;
            if (!flat || flat.length < need) {
              const next = new Float64Array(need);
              if (flat && min > 0) next.set(flat.subarray(0, min * 2));
              flat = next;
            }
            const items = min === 0 ? new Array(count) : this._singleLaneMeasurements.items.slice();
            let runningStart;
            if (min === 0) {
              runningStart = paddingStart + scrollMargin;
            } else {
              const prevIdx = min - 1;
              runningStart = flat[prevIdx * 2] + flat[prevIdx * 2 + 1] + gap;
            }
            for (let i = min; i < count; i++) {
              const key = getItemKey(i);
              items[i] = key;
              const measuredSize = itemSizeCache.get(key);
              const size = typeof measuredSize === "number" ? measuredSize : this.options.estimateSize(i);
              flat[i * 2] = runningStart;
              flat[i * 2 + 1] = size;
              runningStart += size + gap;
            }
            this._singleLaneMeasurements = { flat, items };
            const view = createLazyMeasurementsView(items, flat);
            this.measurementsCache = view;
            return view;
          }
          const measurements = this.measurementsCache.slice(0, min);
          const laneLastIndex = new Array(lanes).fill(
            void 0
          );
          const laneEnds = new Float64Array(lanes);
          let filledLanes = 0;
          for (let m = 0; m < min; m++) {
            const item = measurements[m];
            if (item) {
              if (laneLastIndex[item.lane] === void 0) filledLanes++;
              laneLastIndex[item.lane] = m;
              laneEnds[item.lane] = item.end;
            }
          }
          for (let i = min; i < count; i++) {
            const key = getItemKey(i);
            const cachedLane = this.laneAssignments.get(i);
            let lane;
            let start;
            const shouldCacheLane = laneAssignmentMode === "estimate" || itemSizeCache.has(key);
            if (cachedLane !== void 0 && this.options.lanes > 1) {
              lane = cachedLane;
              const prevIndex = laneLastIndex[lane];
              const prevInLane = prevIndex !== void 0 ? measurements[prevIndex] : void 0;
              start = prevInLane ? prevInLane.end + gap : paddingStart + scrollMargin;
            } else if (filledLanes === lanes) {
              let bestLane = 0;
              let bestEnd = laneEnds[0];
              let bestIdx = laneLastIndex[0];
              for (let l = 1; l < lanes; l++) {
                const e = laneEnds[l];
                if (e < bestEnd || e === bestEnd && laneLastIndex[l] < bestIdx) {
                  bestLane = l;
                  bestEnd = e;
                  bestIdx = laneLastIndex[l];
                }
              }
              lane = bestLane;
              start = bestEnd + gap;
              if (shouldCacheLane) {
                this.laneAssignments.set(i, lane);
              }
            } else {
              lane = i % this.options.lanes;
              start = paddingStart + scrollMargin;
              if (shouldCacheLane) {
                this.laneAssignments.set(i, lane);
              }
            }
            const measuredSize = itemSizeCache.get(key);
            const size = typeof measuredSize === "number" ? measuredSize : this.options.estimateSize(i);
            const end = start + size;
            measurements[i] = {
              index: i,
              start,
              size,
              end,
              key,
              lane
            };
            if (laneLastIndex[lane] === void 0) filledLanes++;
            laneLastIndex[lane] = i;
            laneEnds[lane] = end;
          }
          this.measurementsCache = measurements;
          return measurements;
        },
        {
          key: false,
          debug: () => this.options.debug
        }
      );
      this.calculateRange = memo(
        () => [
          this.getMeasurements(),
          this.getSize(),
          this.getScrollOffset(),
          this.options.lanes
        ],
        (measurements, outerSize, scrollOffset, lanes) => {
          if (measurements.length === 0 || outerSize === 0) {
            this.range = null;
            return null;
          }
          this.range = calculateRangeImpl(
            measurements,
            outerSize,
            scrollOffset,
            lanes,
            // Pass the typed array so binary search + forward-walk can read
            // start/end directly from Float64Array, skipping the Proxy traps.
            lanes === 1 && this._singleLaneMeasurements !== null ? this._singleLaneMeasurements.flat : null
          );
          return this.range;
        },
        {
          key: false,
          debug: () => this.options.debug
        }
      );
      this.getVirtualIndexes = memo(
        () => {
          let startIndex = null;
          let endIndex = null;
          const range = this.calculateRange();
          if (range) {
            startIndex = range.startIndex;
            endIndex = range.endIndex;
          }
          this.maybeNotify.updateDeps([this.isScrolling, startIndex, endIndex]);
          return [
            this.options.rangeExtractor,
            this.options.overscan,
            this.options.count,
            startIndex,
            endIndex
          ];
        },
        (rangeExtractor, overscan, count, startIndex, endIndex) => {
          return startIndex === null || endIndex === null ? [] : rangeExtractor({
            startIndex,
            endIndex,
            overscan,
            count
          });
        },
        {
          key: false,
          debug: () => this.options.debug
        }
      );
      this.indexFromElement = (node) => {
        const attributeName = this.options.indexAttribute;
        const indexStr = node.getAttribute(attributeName);
        if (!indexStr) {
          console.warn(
            `Missing attribute name '${attributeName}={index}' on measured element.`
          );
          return -1;
        }
        return parseInt(indexStr, 10);
      };
      this.shouldMeasureDuringScroll = (index) => {
        var _a2;
        if (!this.scrollState || this.scrollState.behavior !== "smooth") {
          return true;
        }
        const scrollIndex = this.scrollState.index ?? ((_a2 = this.getVirtualItemForOffset(this.scrollState.lastTargetOffset)) == null ? void 0 : _a2.index);
        if (scrollIndex !== void 0 && this.range) {
          const bufferSize = Math.max(
            this.options.overscan,
            Math.ceil((this.range.endIndex - this.range.startIndex) / 2)
          );
          const minIndex = Math.max(0, scrollIndex - bufferSize);
          const maxIndex = Math.min(
            this.options.count - 1,
            scrollIndex + bufferSize
          );
          return index >= minIndex && index <= maxIndex;
        }
        return true;
      };
      this.measureElement = (node) => {
        if (!node) {
          this.elementsCache.forEach((cached, key2) => {
            if (!cached.isConnected) {
              this.observer.unobserve(cached);
              this.elementsCache.delete(key2);
            }
          });
          return;
        }
        const index = this.indexFromElement(node);
        if (!this.isIndexInRange(index)) return;
        const key = this.options.getItemKey(index);
        const prevNode = this.elementsCache.get(key);
        if (prevNode !== node) {
          if (prevNode) {
            this.observer.unobserve(prevNode);
          }
          this.observer.observe(node);
          this.elementsCache.set(key, node);
        }
        if ((!this.isScrolling || this.scrollState) && this.shouldMeasureDuringScroll(index)) {
          this.resizeItem(index, this.options.measureElement(node, void 0, this));
        }
      };
      this.resizeItem = (index, size) => {
        var _a2, _b2, _c2;
        if (!this.isIndexInRange(index)) return;
        let cachedSize;
        let itemStart;
        let key;
        const flat = (_a2 = this._singleLaneMeasurements) == null ? void 0 : _a2.flat;
        if (this.options.lanes === 1 && flat != null) {
          key = this.options.getItemKey(index);
          itemStart = flat[index * 2];
          cachedSize = flat[index * 2 + 1];
        } else {
          const item = this.measurementsCache[index];
          if (!item) return;
          key = item.key;
          itemStart = item.start;
          cachedSize = item.size;
        }
        const itemSize = this.itemSizeCache.get(key) ?? cachedSize;
        const delta = size - itemSize;
        if (delta !== 0) {
          const wasAtEnd = this.options.anchorTo === "end" && ((_b2 = this.scrollState) == null ? void 0 : _b2.behavior) !== "smooth" && this.getVirtualDistanceFromEnd() <= this.options.scrollEndThreshold;
          const prevTotalSize = wasAtEnd ? this.getTotalSize() : 0;
          const scrollOffsetWithAdj = this.getScrollOffset() + this.scrollAdjustments;
          const isFirstMeasure = !this.itemSizeCache.has(key);
          const defaultShouldAdjust = isFirstMeasure ? (
            // First measurement: compensate any item whose top sits above the
            // fold — the estimate→actual delta must be corrected regardless of
            // scroll direction, since the whole estimated block was above it.
            itemStart < scrollOffsetWithAdj
          ) : (
            // Re-measurement: only compensate an item that is ENTIRELY above the
            // fold. An item that merely *spans* the fold (top above, bottom
            // below — e.g. a streaming chat message growing at its bottom)
            // changes size *below* the anchor point, so shifting scrollTop by the
            // delta would drag the viewport downward on every growth (#1218).
            // Also skip during backward scroll to avoid the "items jump while
            // scrolling up" cascade.
            itemStart + itemSize <= scrollOffsetWithAdj && this.scrollDirection !== "backward"
          );
          const shouldAdjustScroll = ((_c2 = this.scrollState) == null ? void 0 : _c2.behavior) !== "smooth" && (this.shouldAdjustScrollPositionOnItemSizeChange !== void 0 ? this.shouldAdjustScrollPositionOnItemSizeChange(
            // The callback expects a VirtualItem; build one lazily only
            // when the consumer actually supplied a custom predicate.
            this.measurementsCache[index] ?? {
              index,
              key,
              start: itemStart,
              size: cachedSize,
              end: itemStart + cachedSize,
              lane: 0
            },
            delta,
            this
          ) : defaultShouldAdjust);
          if (this.pendingMin === null || index < this.pendingMin) {
            this.pendingMin = index;
          }
          this.itemSizeCache.set(key, size);
          this.itemSizeCacheVersion++;
          let adjustedSync = false;
          if (wasAtEnd) {
            adjustedSync = this.applyScrollAdjustment(
              this.getTotalSize() - prevTotalSize
            );
          } else if (shouldAdjustScroll) {
            adjustedSync = this.applyScrollAdjustment(delta);
          }
          this.notify(adjustedSync);
          this._retryClampedAdjustment();
        }
      };
      this.getVirtualItems = memo(
        () => [this.getVirtualIndexes(), this.getMeasurements()],
        (indexes, measurements) => {
          const virtualItems = [];
          for (let k = 0, len = indexes.length; k < len; k++) {
            const i = indexes[k];
            const measurement = measurements[i];
            virtualItems.push(measurement);
          }
          return virtualItems;
        },
        {
          key: false,
          debug: () => this.options.debug
        }
      );
      this.getVirtualItemForOffset = (offset) => {
        var _a2;
        const measurements = this.getMeasurements();
        if (measurements.length === 0) {
          return void 0;
        }
        const flat = (_a2 = this._singleLaneMeasurements) == null ? void 0 : _a2.flat;
        const useFlat = this.options.lanes === 1 && flat != null;
        const idx = findNearestBinarySearch(
          0,
          measurements.length - 1,
          useFlat ? (i) => flat[i * 2] : (i) => notUndefined(measurements[i]).start,
          offset
        );
        return notUndefined(measurements[idx]);
      };
      this.getMaxScrollOffset = () => {
        if (!this.scrollElement) return 0;
        if ("scrollHeight" in this.scrollElement) {
          return this.options.horizontal ? this.scrollElement.scrollWidth - this.scrollElement.clientWidth : this.scrollElement.scrollHeight - this.scrollElement.clientHeight;
        } else {
          const doc = this.scrollElement.document.documentElement;
          return this.options.horizontal ? doc.scrollWidth - this.scrollElement.innerWidth : doc.scrollHeight - this.scrollElement.innerHeight;
        }
      };
      this.getVirtualDistanceFromEnd = () => {
        return Math.max(
          this.getTotalSize() - this.getSize() - this.getScrollOffset(),
          0
        );
      };
      this.getDistanceFromEnd = () => {
        return Math.max(this.getMaxScrollOffset() - this.getScrollOffset(), 0);
      };
      this.isAtEnd = (threshold = this.options.scrollEndThreshold) => {
        return this.getDistanceFromEnd() <= threshold;
      };
      this.getOffsetForAlignment = (toOffset, align, itemSize = 0) => {
        if (!this.scrollElement) return 0;
        const size = this.getSize();
        const scrollOffset = this.getScrollOffset();
        if (align === "auto") {
          align = toOffset >= scrollOffset + size ? "end" : "start";
        }
        if (align === "center") {
          toOffset += (itemSize - size) / 2;
        } else if (align === "end") {
          toOffset -= size;
        }
        const maxOffset = this.getMaxScrollOffset();
        return Math.max(Math.min(maxOffset, toOffset), 0);
      };
      this.getOffsetForIndex = (index, align = "auto") => {
        index = Math.max(0, Math.min(index, this.options.count - 1));
        const size = this.getSize();
        const scrollOffset = this.getScrollOffset();
        const item = this.measurementsCache[index];
        if (!item) return;
        if (align === "auto") {
          if (item.end >= scrollOffset + size - this.options.scrollPaddingEnd) {
            align = "end";
          } else if (item.start <= scrollOffset + this.options.scrollPaddingStart) {
            align = "start";
          } else {
            return [scrollOffset, align];
          }
        }
        if (align === "end" && index === this.options.count - 1) {
          return [this.getMaxScrollOffset(), align];
        }
        const toOffset = align === "end" ? item.end + this.options.scrollPaddingEnd : item.start - this.options.scrollPaddingStart;
        return [
          this.getOffsetForAlignment(toOffset, align, item.size),
          align
        ];
      };
      this.scrollToOffset = (toOffset, { align = "start", behavior = "auto" } = {}) => {
        this._iosDeferredAdjustment = 0;
        const offset = this.getOffsetForAlignment(toOffset, align);
        const now = this.now();
        this.scrollState = {
          index: null,
          align,
          behavior,
          startedAt: now,
          lastTargetOffset: offset,
          stableFrames: 0
        };
        this._scrollToOffset(offset, { adjustments: void 0, behavior });
        this.scheduleScrollReconcile();
      };
      this.scrollToIndex = (index, {
        align: initialAlign = "auto",
        behavior = "auto"
      } = {}) => {
        this._iosDeferredAdjustment = 0;
        index = Math.max(0, Math.min(index, this.options.count - 1));
        const offsetInfo = this.getOffsetForIndex(index, initialAlign);
        if (!offsetInfo) {
          return;
        }
        const [offset, align] = offsetInfo;
        const now = this.now();
        this.scrollState = {
          index,
          align,
          behavior,
          startedAt: now,
          lastTargetOffset: offset,
          stableFrames: 0
        };
        this._scrollToOffset(offset, { adjustments: void 0, behavior });
        this.scheduleScrollReconcile();
      };
      this.scrollBy = (delta, { behavior = "auto" } = {}) => {
        const offset = this.getScrollOffset() + delta;
        const now = this.now();
        this.scrollState = {
          index: null,
          align: "start",
          behavior,
          startedAt: now,
          lastTargetOffset: offset,
          stableFrames: 0
        };
        this._scrollToOffset(offset, { adjustments: void 0, behavior });
        this.scheduleScrollReconcile();
      };
      this.scrollToEnd = ({ behavior = "auto" } = {}) => {
        if (this.options.count > 0) {
          this.scrollToIndex(this.options.count - 1, {
            align: "end",
            behavior
          });
          return;
        }
        this.scrollToOffset(Math.max(this.getTotalSize() - this.getSize(), 0), {
          behavior
        });
      };
      this.getTotalSize = () => {
        var _a2, _b2;
        const measurements = this.getMeasurements();
        let end;
        if (measurements.length === 0) {
          end = this.options.paddingStart;
        } else if (this.options.lanes === 1) {
          const lastIdx = measurements.length - 1;
          const flat = (_a2 = this._singleLaneMeasurements) == null ? void 0 : _a2.flat;
          if (flat != null) {
            end = flat[lastIdx * 2] + flat[lastIdx * 2 + 1];
          } else {
            end = ((_b2 = measurements[lastIdx]) == null ? void 0 : _b2.end) ?? 0;
          }
        } else {
          const endByLane = Array(this.options.lanes).fill(null);
          let endIndex = measurements.length - 1;
          while (endIndex >= 0 && endByLane.some((val) => val === null)) {
            const item = measurements[endIndex];
            if (endByLane[item.lane] === null) {
              endByLane[item.lane] = item.end;
            }
            endIndex--;
          }
          end = Math.max(...endByLane.filter((val) => val !== null));
        }
        return Math.max(
          end - this.options.scrollMargin + this.options.paddingEnd,
          0
        );
      };
      this.takeSnapshot = () => {
        const snapshot = [];
        if (this.itemSizeCache.size === 0) return snapshot;
        const m = this.getMeasurements();
        for (const item of m) {
          if (item && this.itemSizeCache.has(item.key)) {
            snapshot.push({
              index: item.index,
              key: item.key,
              start: item.start,
              size: item.size,
              end: item.end,
              lane: item.lane
            });
          }
        }
        return snapshot;
      };
      this._scrollToOffset = (offset, {
        adjustments,
        behavior
      }) => {
        this._intendedScrollOffset = offset + (adjustments ?? 0);
        this.options.scrollToFn(offset, { behavior, adjustments }, this);
      };
      this.measure = () => {
        this.pendingMin = null;
        this.itemSizeCache.clear();
        this.laneAssignments.clear();
        this.itemSizeCacheVersion++;
        this.notify(false);
      };
      this.setOptions(opts);
    }
    // Returns `true` when it performed a synchronous `scrollTop` write this
    // tick, `false` when the delta was zero or the write was deferred (iOS).
    // `resizeItem` uses that to decide whether the follow-up `notify` must be
    // synchronous so the grown transforms commit in the same paint (#1227).
    applyScrollAdjustment(delta, behavior) {
      if (delta === 0) return false;
      if (isIOSWebKit() && (this.isScrolling || this._iosTouching || this._iosJustTouchEnded)) {
        this._iosDeferredAdjustment += delta;
        return false;
      } else {
        const target = this.getScrollOffset() + this.scrollAdjustments + delta;
        const el = this.scrollElement;
        const maxAtWrite = el !== null && ("scrollHeight" in el || "document" in el) ? this.getMaxScrollOffset() : null;
        this._clampedAdjustment = maxAtWrite !== null && target > maxAtWrite + 0.5 ? { target, maxAtWrite } : null;
        this._scrollToOffset(this.getScrollOffset(), {
          adjustments: this.scrollAdjustments += delta,
          behavior
        });
        if (this.scrollOffset !== null) {
          this.scrollOffset += this.scrollAdjustments;
          if (this.scrollOffset < 0) this.scrollOffset = 0;
          this.scrollAdjustments = 0;
        }
        return true;
      }
    }
    scheduleScrollReconcile() {
      if (!this.targetWindow) {
        this.scrollState = null;
        return;
      }
      if (this.rafId != null) return;
      this.rafId = this.targetWindow.requestAnimationFrame(() => {
        this.rafId = null;
        this.reconcileScroll();
      });
    }
    reconcileScroll() {
      if (!this.scrollState) return;
      const el = this.scrollElement;
      if (!el) return;
      const MAX_RECONCILE_MS = 5e3;
      if (this.now() - this.scrollState.startedAt > MAX_RECONCILE_MS) {
        this.scrollState = null;
        return;
      }
      const offsetInfo = this.scrollState.index != null ? this.getOffsetForIndex(this.scrollState.index, this.scrollState.align) : void 0;
      const targetOffset = offsetInfo ? offsetInfo[0] : this.scrollState.lastTargetOffset;
      const STABLE_FRAMES = 1;
      const targetChanged = targetOffset !== this.scrollState.lastTargetOffset;
      if (!targetChanged && approxEqual(targetOffset, this.getScrollOffset())) {
        this.scrollState.stableFrames++;
        if (this.scrollState.stableFrames >= STABLE_FRAMES) {
          if (this.getScrollOffset() !== targetOffset) {
            this._scrollToOffset(targetOffset, {
              adjustments: void 0,
              behavior: "auto"
            });
          }
          this.scrollState = null;
          return;
        }
      } else {
        this.scrollState.stableFrames = 0;
        if (targetChanged) {
          const viewport = this.getSize() || 600;
          const distance = Math.abs(targetOffset - this.getScrollOffset());
          const keepSmooth = this.scrollState.behavior === "smooth" && distance > viewport;
          this.scrollState.lastTargetOffset = targetOffset;
          if (!keepSmooth) {
            this.scrollState.behavior = "auto";
          }
          this._scrollToOffset(targetOffset, {
            adjustments: void 0,
            behavior: keepSmooth ? "smooth" : "auto"
          });
        }
      }
      this.scheduleScrollReconcile();
    }
  }
  const findNearestBinarySearch = (low, high, getCurrentValue, value) => {
    while (low <= high) {
      const middle = (low + high) / 2 | 0;
      const currentValue = getCurrentValue(middle);
      if (currentValue < value) {
        low = middle + 1;
      } else if (currentValue > value) {
        high = middle - 1;
      } else {
        return middle;
      }
    }
    if (low > 0) {
      return low - 1;
    } else {
      return 0;
    }
  };
  function findNearestBinarySearchFlat(flat, high, value) {
    let low = 0;
    while (low <= high) {
      const middle = (low + high) / 2 | 0;
      const currentValue = flat[middle * 2];
      if (currentValue < value) {
        low = middle + 1;
      } else if (currentValue > value) {
        high = middle - 1;
      } else {
        return middle;
      }
    }
    return low > 0 ? low - 1 : 0;
  }
  function calculateRangeImpl(measurements, outerSize, scrollOffset, lanes, flat) {
    const lastIndex = measurements.length - 1;
    if (measurements.length <= lanes) {
      return { startIndex: 0, endIndex: lastIndex };
    }
    if (lanes === 1 && flat !== null) {
      const startIndex2 = findNearestBinarySearchFlat(
        flat,
        lastIndex,
        scrollOffset
      );
      let endIndex2 = startIndex2;
      const limit = scrollOffset + outerSize;
      while (endIndex2 < lastIndex && flat[endIndex2 * 2] + flat[endIndex2 * 2 + 1] < limit) {
        endIndex2++;
      }
      return { startIndex: startIndex2, endIndex: endIndex2 };
    }
    const getStart = (index) => measurements[index].start;
    let startIndex = findNearestBinarySearch(0, lastIndex, getStart, scrollOffset);
    let endIndex = startIndex;
    if (lanes === 1) {
      while (endIndex < lastIndex && measurements[endIndex].end < scrollOffset + outerSize) {
        endIndex++;
      }
    } else if (lanes > 1) {
      const endPerLane = Array(lanes).fill(0);
      while (endIndex < lastIndex && endPerLane.some((pos) => pos < scrollOffset + outerSize)) {
        const item = measurements[endIndex];
        endPerLane[item.lane] = item.end;
        endIndex++;
      }
      const startPerLane = Array(lanes).fill(scrollOffset + outerSize);
      while (startIndex >= 0 && startPerLane.some((pos) => pos >= scrollOffset)) {
        const item = measurements[startIndex];
        startPerLane[item.lane] = item.start;
        startIndex--;
      }
      startIndex = Math.max(0, startIndex - startIndex % lanes);
      endIndex = Math.min(lastIndex, endIndex + (lanes - 1 - endIndex % lanes));
    }
    return { startIndex, endIndex };
  }
  const useIsomorphicLayoutEffect = typeof document !== "undefined" ? React__namespace.useLayoutEffect : React__namespace.useEffect;
  function useVirtualizerBase({
    useFlushSync = true,
    directDomUpdates = false,
    directDomUpdatesMode = "transform",
    ...options
  }) {
    const rerender = React__namespace.useReducer((x) => x + 1, 0)[1];
    const directRef = React__namespace.useRef({
      enabled: directDomUpdates,
      mode: directDomUpdatesMode,
      container: null,
      lastSize: null,
      // Keyed by the element itself so a remounted node (same key, new DOM
      // node — e.g. when `enabled` is toggled off then on) is treated as fresh
      // and gets its style written.
      lastPositions: /* @__PURE__ */ new WeakMap(),
      prevRange: null
    });
    directRef.current.enabled = directDomUpdates;
    directRef.current.mode = directDomUpdatesMode;
    const measuringFromRef = React__namespace.useRef(false);
    const applyContainerSize = (instance2) => {
      const state = directRef.current;
      if (!state.enabled || !state.container) return;
      const totalSize = instance2.getTotalSize();
      if (totalSize !== state.lastSize) {
        state.lastSize = totalSize;
        const sizeAxis = instance2.options.horizontal ? "width" : "height";
        state.container.style[sizeAxis] = `${totalSize}px`;
      }
    };
    const applyDirectStyles = (instance2) => {
      const state = directRef.current;
      if (!state.enabled || !state.container) return;
      applyContainerSize(instance2);
      const horizontal = !!instance2.options.horizontal;
      const useTransform = state.mode === "transform";
      const posAxis = horizontal ? "left" : "top";
      const scrollMargin = instance2.options.scrollMargin;
      const items = instance2.getVirtualItems();
      for (const item of items) {
        const next = item.start - scrollMargin;
        const el = instance2.elementsCache.get(item.key);
        if (!el) continue;
        if (state.lastPositions.get(el) === next) continue;
        state.lastPositions.set(el, next);
        if (useTransform) {
          el.style.transform = horizontal ? `translate3d(${next}px, 0, 0)` : `translate3d(0, ${next}px, 0)`;
        } else {
          el.style[posAxis] = `${next}px`;
        }
      }
    };
    const resolvedOptions = {
      ...options,
      onChange: (instance2, sync) => {
        var _a2;
        const state = directRef.current;
        let shouldRerender = true;
        if (state.enabled) {
          applyDirectStyles(instance2);
          const range = instance2.range;
          const prev = state.prevRange;
          shouldRerender = !prev || prev.isScrolling !== instance2.isScrolling || prev.startIndex !== (range == null ? void 0 : range.startIndex) || prev.endIndex !== (range == null ? void 0 : range.endIndex);
          if (shouldRerender) {
            state.prevRange = range ? {
              startIndex: range.startIndex,
              endIndex: range.endIndex,
              isScrolling: instance2.isScrolling
            } : null;
          }
        }
        if (shouldRerender) {
          if (useFlushSync && sync && !measuringFromRef.current) {
            reactDom.flushSync(rerender);
          } else {
            rerender();
          }
        }
        (_a2 = options.onChange) == null ? void 0 : _a2.call(options, instance2, sync);
      }
    };
    const [instance] = React__namespace.useState(() => {
      const v = new Virtualizer(resolvedOptions);
      const measureElement2 = v.measureElement;
      v.measureElement = (node) => {
        measuringFromRef.current = true;
        try {
          measureElement2(node);
        } finally {
          measuringFromRef.current = false;
        }
      };
      return Object.assign(v, {
        containerRef: (node) => {
          const state = directRef.current;
          state.container = node;
          state.lastSize = null;
          if (node && state.enabled) {
            const total = v.getTotalSize();
            state.lastSize = total;
            const axis = v.options.horizontal ? "width" : "height";
            node.style[axis] = `${total}px`;
          }
        }
      });
    });
    instance.setOptions(resolvedOptions);
    useIsomorphicLayoutEffect(() => {
      return instance._didMount();
    }, []);
    useIsomorphicLayoutEffect(() => {
      applyContainerSize(instance);
      return instance._willUpdate();
    });
    useIsomorphicLayoutEffect(() => {
      applyDirectStyles(instance);
    });
    return instance;
  }
  function useVirtualizer(options) {
    return useVirtualizerBase({
      observeElementRect,
      observeElementOffset,
      scrollToFn: elementScroll,
      ...options
    });
  }
  const K = () => {
    const k = window.GITTER_KIT;
    if (!k) throw new Error("GITTER_KIT 未注入（外部页必须经宿主 pageLoader 装载）");
    return k;
  };
  const React = K().React;
  K().ReactDOM;
  const ReactDOMClient = K().ReactDOMClient;
  const DiffView = K().DiffView;
  K().MonacoDiffView;
  K().diffStatusLetter;
  K().renderSegments;
  K().wordDiff;
  K().SplitPane;
  K().Banner;
  const Modal = K().Modal;
  const useContextMenu = K().useContextMenu;
  K().SyncBar;
  K().useSyncProgress;
  K().renderMarkdown;
  K().registerMarkdownPlugin;
  const PageErrorBoundary = K().PageErrorBoundary;
  K().NavIcon;
  K().Select;
  K().ReflogDialog;
  K().ScrollArea;
  function nativeSepOf(workDir) {
    return workDir.replace(/[\\/]+$/, "").includes("\\") ? "\\" : "/";
  }
  function absPathOf(workDir, rel) {
    const base = workDir.replace(/[\\/]+$/, "");
    const sep = nativeSepOf(workDir);
    const tail = rel.replace(/\\/g, "/").replace(/^[/\\]+/, "");
    return base + sep + tail.split("/").join(sep);
  }
  function relOfWork(workDir, abs) {
    const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "");
    const base = norm(workDir);
    const a = norm(abs);
    if (!a.toLowerCase().startsWith(base.toLowerCase() + "/")) return null;
    return a.slice(base.length + 1);
  }
  const EXT_ICON = {
    // JavaScript 生态
    ts: { g: "hex", c: "#519ABA" },
    tsx: { g: "hex", c: "#519ABA" },
    js: { g: "jsq", c: "#DDB15A" },
    mjs: { g: "jsq", c: "#DDB15A" },
    cjs: { g: "jsq", c: "#DDB15A" },
    jsx: { g: "jsq", c: "#DDB15A" },
    json: { g: "braces", c: "#DDB15A" },
    jsonc: { g: "braces", c: "#DDB15A" },
    // 样式
    css: { g: "hash", c: "#519ABA" },
    scss: { g: "hash", c: "#C879B2" },
    sass: { g: "hash", c: "#C879B2" },
    less: { g: "hash", c: "#519ABA" },
    // 标记语言
    html: { g: "angle", c: "#E37933" },
    htm: { g: "angle", c: "#E37933" },
    vue: { g: "angle", c: "#519ABA" },
    svelte: { g: "angle", c: "#E37933" },
    xml: { g: "angle", c: "#A074C4" },
    xaml: { g: "angle", c: "#A074C4" },
    csproj: { g: "angle", c: "#519ABA" },
    props: { g: "angle", c: "#8F8F8F" },
    targets: { g: "angle", c: "#8F8F8F" },
    config: { g: "angle", c: "#8F8F8F" },
    sln: { g: "angle", c: "#8F8F8F" },
    // 编译型语言（六边形族，语言色区分）
    cs: { g: "hex", c: "#519ABA" },
    go: { g: "hex", c: "#519ABA" },
    rs: { g: "hex", c: "#C879B2" },
    java: { g: "hex", c: "#C879B2" },
    kt: { g: "hex", c: "#C879B2" },
    swift: { g: "hex", c: "#E37933" },
    scala: { g: "hex", c: "#C879B2" },
    c: { g: "hex", c: "#8F8F8F" },
    h: { g: "hex", c: "#8F8F8F" },
    cpp: { g: "hex", c: "#519ABA" },
    hpp: { g: "hex", c: "#519ABA" },
    cc: { g: "hex", c: "#519ABA" },
    py: { g: "hex", c: "#519ABA" },
    rb: { g: "hex", c: "#C85A5A" },
    php: { g: "hex", c: "#8F8F8F" },
    // 脚本 / 终端
    sh: { g: "term", c: "#8F8F8F" },
    bash: { g: "term", c: "#8F8F8F" },
    zsh: { g: "term", c: "#8F8F8F" },
    ps1: { g: "term", c: "#519ABA" },
    psm1: { g: "term", c: "#519ABA" },
    psd1: { g: "term", c: "#519ABA" },
    bat: { g: "term", c: "#8F8F8F" },
    cmd: { g: "term", c: "#8F8F8F" },
    // 纯文本文档
    md: { g: "text", c: "#6BABF5" },
    markdown: { g: "text", c: "#6BABF5" },
    txt: { g: "text", c: "#8F8F8F" },
    log: { g: "text", c: "#8F8F8F" },
    gitignore: { g: "text", c: "#E37933" },
    // 配置
    yml: { g: "gear", c: "#DDB15A" },
    yaml: { g: "gear", c: "#DDB15A" },
    toml: { g: "gear", c: "#DDB15A" },
    ini: { g: "gear", c: "#8F8F8F" },
    cfg: { g: "gear", c: "#8F8F8F" },
    properties: { g: "gear", c: "#8F8F8F" },
    editorconfig: { g: "gear", c: "#8F8F8F" },
    lock: { g: "gear", c: "#8F8F8F" },
    // 图片
    png: { g: "pic", c: "#A074C4" },
    jpg: { g: "pic", c: "#A074C4" },
    jpeg: { g: "pic", c: "#A074C4" },
    gif: { g: "pic", c: "#A074C4" },
    webp: { g: "pic", c: "#A074C4" },
    bmp: { g: "pic", c: "#A074C4" },
    avif: { g: "pic", c: "#A074C4" },
    ico: { g: "pic", c: "#A074C4" }
  };
  const DEFAULT_ICON = { g: "doc", c: "#8F8F8F" };
  function iconForPath(path) {
    const base = path.split("/").pop() ?? path;
    if (base.toLowerCase() === ".gitignore") return EXT_ICON.gitignore;
    const dot = base.lastIndexOf(".");
    const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
    return EXT_ICON[ext] ?? DEFAULT_ICON;
  }
  const GLYPH_PATHS = {
    hex: (c) => /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M8 1.8 13.6 5v6L8 14.2 2.4 11V5z", stroke: c, strokeWidth: "1.1", strokeLinejoin: "round" }),
    braces: (c) => /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
      /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M6.8 2.5c-1.7 0-1.1 4.1-2.9 5.5 1.8 1.4 1.2 5.5 2.9 5.5", stroke: c, strokeWidth: "1.15", strokeLinecap: "round", fill: "none" }),
      /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M9.2 2.5c1.7 0 1.1 4.1 2.9 5.5-1.8 1.4-1.2 5.5-2.9 5.5", stroke: c, strokeWidth: "1.15", strokeLinecap: "round", fill: "none" })
    ] }),
    hash: (c) => /* @__PURE__ */ jsxRuntime.jsx(jsxRuntime.Fragment, { children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M6.2 2.8 5 13.2M11 2.8 9.8 13.2M2.9 6.2h10.4M2.7 10h10.4", stroke: c, strokeWidth: "1.1", strokeLinecap: "round", fill: "none" }) }),
    angle: (c) => /* @__PURE__ */ jsxRuntime.jsx(jsxRuntime.Fragment, { children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M5.4 4.6 2.4 8l3 3.4M10.6 4.6 13.6 8l-3 3.4", stroke: c, strokeWidth: "1.15", strokeLinecap: "round", strokeLinejoin: "round", fill: "none" }) }),
    text: (c) => /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
      /* @__PURE__ */ jsxRuntime.jsx("rect", { x: "3", y: "2.2", width: "10", height: "11.6", rx: "1", stroke: c, strokeWidth: "1.1", fill: "none" }),
      /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M5.4 6h5.2M5.4 8.6h5.2M5.4 11.2h3.2", stroke: c, strokeWidth: "1", strokeLinecap: "round" })
    ] }),
    term: (c) => /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
      /* @__PURE__ */ jsxRuntime.jsx("rect", { x: "2.2", y: "3", width: "11.6", height: "10", rx: "1.2", stroke: c, strokeWidth: "1.1", fill: "none" }),
      /* @__PURE__ */ jsxRuntime.jsx("path", { d: "m4.6 6.4 1.9 1.6-1.9 1.6M8.2 10.2h3.4", stroke: c, strokeWidth: "1.05", strokeLinecap: "round", strokeLinejoin: "round" })
    ] }),
    pic: (c) => /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
      /* @__PURE__ */ jsxRuntime.jsx("rect", { x: "2.4", y: "3", width: "11.2", height: "10", rx: "1.2", stroke: c, strokeWidth: "1.1", fill: "none" }),
      /* @__PURE__ */ jsxRuntime.jsx("circle", { cx: "6", cy: "6.3", r: "1.05", stroke: c, strokeWidth: "1", fill: "none" }),
      /* @__PURE__ */ jsxRuntime.jsx("path", { d: "m4.4 11.4 2.9-2.9 1.9 1.9 1.5-1.5 2 2.3", stroke: c, strokeWidth: "1", strokeLinecap: "round", strokeLinejoin: "round", fill: "none" })
    ] }),
    gear: (c) => /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
      /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M2.8 5.4h10.4M2.8 10.6h10.4", stroke: c, strokeWidth: "1.1", strokeLinecap: "round" }),
      /* @__PURE__ */ jsxRuntime.jsx("circle", { cx: "6.1", cy: "5.4", r: "1.5", fill: "var(--c-base, #222)", stroke: c, strokeWidth: "1.1" }),
      /* @__PURE__ */ jsxRuntime.jsx("circle", { cx: "10.2", cy: "10.6", r: "1.5", fill: "var(--c-base, #222)", stroke: c, strokeWidth: "1.1" })
    ] }),
    jsq: (c) => /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
      /* @__PURE__ */ jsxRuntime.jsx("rect", { x: "2.6", y: "2.6", width: "10.8", height: "10.8", rx: "2", stroke: c, strokeWidth: "1.1", fill: "none" }),
      /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M6.2 5.6v3.2c0 .9-.5 1.3-1.2 1.3M9.9 5.9c-.4-.4-1.9-.6-2.3.2-.4 1 2.7.9 2.4 2.6-.3 1.1-2 1.1-2.8.5", stroke: c, strokeWidth: "1", strokeLinecap: "round", fill: "none" })
    ] }),
    doc: (c) => /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
      /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M4 1.8h5.2L12.8 5.4V14a.8.8 0 0 1-.8.8H4a.8.8 0 0 1-.8-.8V2.6c0-.44.36-.8.8-.8z", stroke: c, strokeWidth: "1.1", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M9 2v3.4h3.4", stroke: c, strokeWidth: "1.1", strokeLinejoin: "round" })
    ] })
  };
  function FileIcon({ path }) {
    const { g, c } = iconForPath(path);
    return /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: GLYPH_PATHS[g](c) });
  }
  const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", strokeLinejoin: "round" };
  const ChevronIcon = () => /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "10", height: "10", viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M6 3.5 10.5 8 6 12.5", ...S, strokeWidth: "1.4" }) });
  const ChevronSepIcon = () => /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "11", height: "11", viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M6 3.5 10.5 8 6 12.5", ...S, strokeWidth: "1.3" }) });
  const ChevronUpIcon = () => /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "12", height: "12", viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M3.5 10 8 5.5 12.5 10", ...S, strokeWidth: 1.3 }) });
  const ChevronDownIcon = () => /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "12", height: "12", viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M3.5 6 8 10.5 12.5 6", ...S, strokeWidth: 1.3 }) });
  const FilterIcon = () => /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "14", height: "14", viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M2.5 3.5h11L9.5 8.4v4.1l-3 1.5V8.4z", ...S }) });
  const RefreshIcon = () => /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "14", height: "14", viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M13 8a5 5 0 1 1-1.5-3.6M13.2 1.8v3h-3", ...S }) });
  const CollapseAllIcon = () => /* @__PURE__ */ jsxRuntime.jsxs("svg", { width: "14", height: "14", viewBox: "0 0 16 16", "aria-hidden": "true", children: [
    /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M4.5 3 8 6.5 11.5 3", ...S, strokeWidth: 1.3 }),
    /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M4.5 13 8 9.5 11.5 13", ...S, strokeWidth: 1.3 })
  ] });
  const ExpandAllIcon = () => /* @__PURE__ */ jsxRuntime.jsxs("svg", { width: "14", height: "14", viewBox: "0 0 16 16", "aria-hidden": "true", children: [
    /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M4.5 6.5 8 3l3.5 3.5", ...S, strokeWidth: 1.3 }),
    /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M4.5 9.5 8 13l3.5-3.5", ...S, strokeWidth: 1.3 })
  ] });
  const CloseIcon = () => /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "11", height: "11", viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "m4 4 8 8M12 4l-8 8", ...S, strokeWidth: "1.3" }) });
  const SparkIcon = () => /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "11", height: "11", viewBox: "0 0 16 16", fill: "currentColor", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M8 1.5 9.4 6 14 7.4 9.4 8.8 8 13.4 6.6 8.8 2 7.4 6.6 6z" }) });
  const SearchIcon = () => /* @__PURE__ */ jsxRuntime.jsxs("svg", { width: "14", height: "14", viewBox: "0 0 16 16", "aria-hidden": "true", children: [
    /* @__PURE__ */ jsxRuntime.jsx("circle", { cx: "7", cy: "7", r: "4.2", ...S }),
    /* @__PURE__ */ jsxRuntime.jsx("path", { d: "m10.4 10.4 3 3", ...S })
  ] });
  const SplitIcon = () => /* @__PURE__ */ jsxRuntime.jsxs("svg", { width: "14", height: "14", viewBox: "0 0 16 16", "aria-hidden": "true", children: [
    /* @__PURE__ */ jsxRuntime.jsx("rect", { x: "2.5", y: "2.5", width: "11", height: "11", rx: "1.2", ...S }),
    /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M8 2.5v11", ...S })
  ] });
  const CheckIcon = () => /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "13", height: "13", viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "m3 8.5 3.2 3.2L13 5", ...S, strokeWidth: "1.4" }) });
  const OpenExternalIcon = () => /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "13", height: "13", viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M6.5 3.5H4A1.5 1.5 0 0 0 2.5 5v7A1.5 1.5 0 0 0 4 13.5h7a1.5 1.5 0 0 0 1.5-1.5V9.5M9 2.5h4.5V7M13 3 7.5 8.5", ...S }) });
  const PencilIcon = () => /* @__PURE__ */ jsxRuntime.jsxs("svg", { width: "13", height: "13", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [
    /* @__PURE__ */ jsxRuntime.jsx("path", { d: "m11.3 2.1 2.6 2.6c.3.3.3.8 0 1.1L6.3 13.4 2.5 14l.6-3.8 7.1-7.1c.3-.3.8-.3 1.1 0z", stroke: "currentColor", strokeWidth: "1.1", strokeLinejoin: "round" }),
    /* @__PURE__ */ jsxRuntime.jsx("path", { d: "m9.9 3.6 2.5 2.5", stroke: "currentColor", strokeWidth: "1.1" })
  ] });
  const FolderIcon = ({ size = 14 }) => /* @__PURE__ */ jsxRuntime.jsx("svg", { width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M1.8 4.2c0-.6.4-1 1-1h3l1.4 1.6h5.9c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1z", ...S }) });
  const DiffIcon = () => /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "13", height: "13", viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M4.5 2.5v7M4.5 2.5 2.5 4.5M4.5 2.5l2 2M11.5 13.5v-7M11.5 13.5l-2-2M11.5 13.5l2-2", ...S }) });
  const CopyIcon = () => /* @__PURE__ */ jsxRuntime.jsxs("svg", { width: "13", height: "13", viewBox: "0 0 16 16", "aria-hidden": "true", children: [
    /* @__PURE__ */ jsxRuntime.jsx("rect", { x: "5.5", y: "5.5", width: "8", height: "8", rx: "1.2", ...S }),
    /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5", ...S })
  ] });
  const RevealIcon = () => /* @__PURE__ */ jsxRuntime.jsx(FolderIcon, { size: 13 });
  const TrashIcon = () => /* @__PURE__ */ jsxRuntime.jsxs("svg", { width: "13", height: "13", viewBox: "0 0 16 16", "aria-hidden": "true", children: [
    /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M2.8 4.2h10.4M6.2 4.2V2.8c0-.44.36-.8.8-.8h2c.44 0 .8.36.8.8v1.4M4.2 4.2l.6 8.6c.03.44.4.8.8.8h4.8c.4 0 .77-.36.8-.8l.6-8.6", ...S, strokeWidth: "1.1" }),
    /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M6.6 6.8v4.4M9.4 6.8v4.4", ...S, strokeWidth: "1.1" })
  ] });
  const CutIcon = () => /* @__PURE__ */ jsxRuntime.jsxs("svg", { width: "13", height: "13", viewBox: "0 0 16 16", "aria-hidden": "true", children: [
    /* @__PURE__ */ jsxRuntime.jsx("circle", { cx: "4", cy: "12", r: "1.7", ...S, strokeWidth: "1.1" }),
    /* @__PURE__ */ jsxRuntime.jsx("circle", { cx: "12", cy: "12", r: "1.7", ...S, strokeWidth: "1.1" }),
    /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M5.2 10.8 12 1.8M10.8 10.8 4 1.8", ...S, strokeWidth: "1.1" })
  ] });
  const PasteIcon = () => /* @__PURE__ */ jsxRuntime.jsxs("svg", { width: "13", height: "13", viewBox: "0 0 16 16", "aria-hidden": "true", children: [
    /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M5.5 3.2H4.2c-.66 0-1.2.54-1.2 1.2v8.4c0 .66.54 1.2 1.2 1.2h7.6c.66 0 1.2-.54 1.2-1.2V4.4c0-.66-.54-1.2-1.2-1.2h-1.3", ...S, strokeWidth: "1.1" }),
    /* @__PURE__ */ jsxRuntime.jsx("rect", { x: "5.5", y: "1.8", width: "5", height: "2.8", rx: "0.7", ...S, strokeWidth: "1.1" })
  ] });
  const PinIcon = () => /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "11", height: "11", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M9.5 1.8 14.2 6.5l-1.6.5-2.8 2.8-.4 3.4-1.5-1.5-3.6 2.5 2.5-3.6L5.3 9.1l3.4-.4L11.5 6z", stroke: "currentColor", strokeWidth: "1.1", strokeLinejoin: "round" }) });
  const OutlineIcon = () => /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "13", height: "13", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M2.5 3.5h11M5 7h8.5M5 10.5h8.5M8 14h5.5", stroke: "currentColor", strokeWidth: "1.2", strokeLinecap: "round" }) });
  const NewFileIcon = () => /* @__PURE__ */ jsxRuntime.jsxs("svg", { width: "13", height: "13", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [
    /* @__PURE__ */ jsxRuntime.jsx(
      "path",
      {
        d: "M4 1.8h5.2L12.8 5.4V14a.8.8 0 0 1-.8.8H4a.8.8 0 0 1-.8-.8V2.6c0-.44.36-.8.8-.8z",
        stroke: "currentColor",
        strokeWidth: "1.1",
        strokeLinejoin: "round"
      }
    ),
    /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M9 2v3.4h3.4", stroke: "currentColor", strokeWidth: "1.1", strokeLinejoin: "round" }),
    /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M8.4 7.2v4M6.4 9.2h4", stroke: "currentColor", strokeWidth: "1.2", strokeLinecap: "round" })
  ] });
  const NewFolderIcon = () => /* @__PURE__ */ jsxRuntime.jsxs("svg", { width: "13", height: "13", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [
    /* @__PURE__ */ jsxRuntime.jsx(
      "path",
      {
        d: "M1.8 4.2c0-.6.4-1 1-1h3l1.4 1.6h5.9c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1z",
        stroke: "currentColor",
        strokeWidth: "1.1",
        strokeLinejoin: "round"
      }
    ),
    /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M8 6.8v3.6M6.2 8.6h3.6", stroke: "currentColor", strokeWidth: "1.2", strokeLinecap: "round" })
  ] });
  const ROW_H$1 = 24;
  const STATUS_CLS$1 = { M: "gs-M", A: "gs-A", D: "gs-D", R: "gs-R", U: "gs-U", "?": "gs-Q" };
  const STATUS_LETTER$1 = { M: "M", A: "A", D: "D", R: "R", U: "U", "?": "?" };
  const DIR_PRIO = ["U", "D", "M", "A", "R", "?"];
  const DRAFT_PATH = "\0draft";
  function nameValidationError(name) {
    return !name || name.length > 255 || name.toLowerCase() === ".git" || /[\\/:*?"<>|\u0000-\u001f]/.test(name) || /[.\s]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name);
  }
  function TreePane(props) {
    const t = pageSdk.t;
    const [mode, setMode] = React$1.useState("all");
    const [filterOn, setFilterOn] = React$1.useState(false);
    const [query, setQuery] = React$1.useState("");
    const [collapsed, setCollapsed] = React$1.useState(/* @__PURE__ */ new Set());
    const [draft, setDraft] = React$1.useState(null);
    const [draftName, setDraftName] = React$1.useState("");
    const draftInputRef = React$1.useRef(null);
    const [clip, setClip] = React$1.useState(null);
    const [confirmDel, setConfirmDel] = React$1.useState(null);
    const [dragItem, setDragItem] = React$1.useState(null);
    const [dropTarget, setDropTarget] = React$1.useState(null);
    const [selectedPath, setSelectedPath] = React$1.useState(null);
    const [kbFocus, setKbFocus] = React$1.useState(null);
    const [kbKey, setKbKey] = React$1.useState(false);
    const parentRef = React$1.useRef(null);
    const filterInputRef = React$1.useRef(null);
    const { showMenu, menuElement } = useContextMenu();
    const q = query.trim().toLowerCase();
    const files = React$1.useMemo(() => {
      let fs = props.entries.filter((e) => !e.isDir);
      if (mode === "git") fs = fs.filter((f) => f.status !== null);
      if (q) fs = fs.filter((f) => f.path.toLowerCase().includes(q));
      return fs;
    }, [props.entries, mode, q]);
    const forceOpen = mode !== "all" || q !== "";
    const counts = React$1.useMemo(() => ({
      git: props.entries.filter((e) => !e.isDir && e.status !== null).length
    }), [props.entries]);
    const visibleNodes = React$1.useMemo(() => {
      const nodes = [];
      const dirStatus = /* @__PURE__ */ new Map();
      const filesByDir = /* @__PURE__ */ new Map();
      for (const f of files) {
        const parts = f.path.split("/");
        let acc = "";
        for (let i = 0; i < parts.length - 1; i++) {
          acc = acc ? `${acc}/${parts[i]}` : parts[i];
          if (!filesByDir.has(acc)) filesByDir.set(acc, []);
          if (f.status) {
            const cur = dirStatus.get(acc) ?? null;
            if (cur === null || DIR_PRIO.indexOf(f.status) < DIR_PRIO.indexOf(cur)) dirStatus.set(acc, f.status);
          }
        }
        const parent = parts.length > 1 ? acc : "";
        if (!filesByDir.has(parent)) filesByDir.set(parent, []);
        filesByDir.get(parent).push(f);
      }
      const walk = (dir, depth) => {
        const s = dirStatus.get(dir) ?? null;
        const open = forceOpen || !collapsed.has(dir);
        nodes.push({ entry: { path: dir, isDir: true, status: s, touchedByAgent: false }, depth, dirStatus: s, open });
        if (!open) return;
        const subdirs = [...filesByDir.keys()].filter((d) => d.startsWith(dir + "/") && !d.slice(dir.length + 1).includes("/")).sort();
        for (const sub of subdirs) walk(sub, depth + 1);
        for (const f of (filesByDir.get(dir) ?? []).slice().sort((a, b) => a.path.localeCompare(b.path))) {
          nodes.push({ entry: f, depth: depth + 1, dirStatus: null, open: false });
        }
      };
      const roots = [...filesByDir.keys()].filter((d) => d !== "" && !d.includes("/")).sort();
      for (const r of roots) walk(r, 0);
      for (const f of (filesByDir.get("") ?? []).slice().sort((a, b) => a.path.localeCompare(b.path))) {
        nodes.push({ entry: f, depth: 0, dirStatus: null, open: false });
      }
      if (draft) {
        const node = {
          entry: { path: DRAFT_PATH, isDir: draft.kind === "dir", status: null, touchedByAgent: false },
          depth: 0,
          dirStatus: null,
          open: false,
          draft: true
        };
        let di = -1;
        if (draft.mode === "rename" && draft.renameOf) {
          di = nodes.findIndex((n) => !n.draft && n.entry.path === draft.renameOf);
          if (di >= 0) node.depth = nodes[di].depth;
        } else if (draft.dir) {
          di = nodes.findIndex((n) => n.entry.isDir && n.entry.path === draft.dir);
          if (di >= 0) node.depth = nodes[di].depth + 1;
        }
        if (di >= 0) nodes.splice(di + 1, 0, node);
        else nodes.unshift(node);
      }
      return nodes;
    }, [files, forceOpen, collapsed, draft]);
    const nodesRef = React$1.useRef(visibleNodes);
    nodesRef.current = visibleNodes;
    const virtualizer = useVirtualizer({
      count: visibleNodes.length,
      getScrollElement: () => parentRef.current,
      estimateSize: () => ROW_H$1,
      overscan: 12
    });
    React$1.useEffect(() => {
      const path = props.activePath;
      if (!path) return;
      setCollapsed((prev) => {
        const segs = path.split("/").slice(0, -1);
        if (!segs.some((s) => prev.has(s))) return prev;
        const next = new Set(prev);
        let acc = "";
        for (const s of segs) {
          acc = acc ? `${acc}/${s}` : s;
          next.delete(acc);
        }
        return next;
      });
      const raf = requestAnimationFrame(() => {
        const idx = nodesRef.current.findIndex((n) => n.entry.path === path);
        if (idx < 0) return;
        const items = virtualizer.getVirtualItems();
        if (items.length === 0) return;
        if (idx >= items[0].index && idx <= items[items.length - 1].index) return;
        virtualizer.scrollToIndex(idx, { align: "auto" });
      });
      return () => cancelAnimationFrame(raf);
    }, [props.activePath, props.revealTick]);
    const toggleDir = React$1.useCallback((path) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
    }, []);
    const collapseInitRef = React$1.useRef(false);
    React$1.useEffect(() => {
      if (collapseInitRef.current || props.entries.length === 0) return;
      collapseInitRef.current = true;
      const dirs = /* @__PURE__ */ new Set();
      for (const e of props.entries) {
        const parts = e.path.split("/");
        let acc2 = "";
        for (let i = 0; i < parts.length - 1; i++) {
          acc2 = acc2 ? `${acc2}/${parts[i]}` : parts[i];
          dirs.add(acc2);
        }
      }
      const segs = (props.activePath ?? "").split("/");
      let acc = "";
      for (let i = 0; i < segs.length - 1; i++) {
        acc = acc ? `${acc}/${segs[i]}` : segs[i];
        dirs.delete(acc);
      }
      if (dirs.size > 0) setCollapsed(dirs);
    }, [props.entries]);
    const startDraft = React$1.useCallback((dir, kind) => {
      setDraft({ dir, kind, mode: "create" });
      setDraftName("");
      setCollapsed((prev) => {
        const segs = dir ? dir.split("/") : [];
        let acc = "";
        if (!segs.some((s) => {
          acc = acc ? `${acc}/${s}` : s;
          return prev.has(acc);
        })) return prev;
        const next = new Set(prev);
        acc = "";
        for (const s of segs) {
          acc = acc ? `${acc}/${s}` : s;
          next.delete(acc);
        }
        return next;
      });
    }, []);
    const startRename = React$1.useCallback((path, isDir) => {
      setDraft({
        dir: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
        kind: isDir ? "dir" : "file",
        mode: "rename",
        renameOf: path
      });
      setDraftName(path.split("/").pop() ?? path);
    }, []);
    const selectedDir = React$1.useCallback(() => {
      if (!selectedPath) return "";
      const n = nodesRef.current.find((x) => x.entry.path === selectedPath);
      if (!n || n.draft) return "";
      if (n.entry.isDir) return n.entry.path;
      return n.entry.path.includes("/") ? n.entry.path.slice(0, n.entry.path.lastIndexOf("/")) : "";
    }, [selectedPath]);
    const commitDraft = React$1.useCallback(async () => {
      var _a2, _b2, _c2;
      const d = draft;
      if (!d) return;
      const name = draftName.trim();
      if (nameValidationError(name)) {
        pageSdk.toast(pageSdk.t("Files_Title"), pageSdk.t(name ? "Files_InvalidName" : "Files_NameRequired"));
        (_a2 = draftInputRef.current) == null ? void 0 : _a2.focus();
        return;
      }
      if (d.mode === "rename") {
        const old = d.renameOf;
        const base = old.split("/").pop() ?? old;
        if (name === base) {
          setDraft(null);
          return;
        }
        const ok = props.onRename ? await props.onRename(old, name, d.kind === "dir") : false;
        if (ok) setDraft(null);
        else (_b2 = draftInputRef.current) == null ? void 0 : _b2.focus();
        return;
      }
      if (await props.onCreate(d.dir, name, d.kind)) setDraft(null);
      else (_c2 = draftInputRef.current) == null ? void 0 : _c2.focus();
    }, [draft, draftName, props.onCreate, props.onRename]);
    React$1.useEffect(() => {
      if (!draft) return;
      const raf = requestAnimationFrame(() => {
        var _a2;
        (_a2 = draftInputRef.current) == null ? void 0 : _a2.focus();
        if (draft.mode === "rename") {
          const el = draftInputRef.current;
          if (el) {
            const dot = el.value.lastIndexOf(".");
            el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
          }
        }
      });
      return () => cancelAnimationFrame(raf);
    }, [draft]);
    const copyText = React$1.useCallback(async (text) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
      }
    }, []);
    const copyPath = React$1.useCallback(async (rel, absolute) => {
      let p = rel;
      if (absolute) {
        const repo = pageSdk.repo();
        if (repo == null ? void 0 : repo.workDir) p = absPathOf(repo.workDir, rel);
      }
      void copyText(p);
    }, [copyText]);
    const openExternal = React$1.useCallback((rel) => {
      const repo = pageSdk.repo();
      void pageSdk.call("shell.openPath", { path: (repo == null ? void 0 : repo.workDir) ? absPathOf(repo.workDir, rel) : rel, editor: true });
    }, []);
    const reveal = React$1.useCallback((rel) => {
      const repo = pageSdk.repo();
      void pageSdk.call("shell.reveal", { path: (repo == null ? void 0 : repo.workDir) ? absPathOf(repo.workDir, rel) : rel });
    }, []);
    const doPaste = React$1.useCallback((c, toDir) => {
      if (!props.onPaste) return;
      void props.onPaste(c.path, toDir, c.cut, c.isDir).then((ok) => {
        if (ok && c.cut) setClip(null);
      });
    }, [props.onPaste]);
    const canPasteInto = React$1.useCallback((c, toDir) => {
      if (!c) return false;
      if (c.path === toDir || toDir.startsWith(c.path + "/")) return false;
      if (c.cut && (c.path.includes("/") ? c.path.slice(0, c.path.lastIndexOf("/")) : "") === toDir) return false;
      return true;
    }, []);
    const dropMove = React$1.useCallback((toDir) => {
      const d = dragItem;
      setDragItem(null);
      setDropTarget(null);
      if (!d) return;
      const clip2 = { path: d.path, isDir: d.isDir, cut: true };
      if (!canPasteInto(clip2, toDir)) return;
      doPaste(clip2, toDir);
    }, [dragItem, canPasteInto, doPaste]);
    const menuFor = React$1.useCallback((node) => {
      const path = node.entry.path;
      const parentOf = (p) => p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
      const mutators = props.onRename && props.onDelete && props.onPaste;
      if (node.entry.isDir) {
        return [
          { label: t("Files_NewFile"), icon: /* @__PURE__ */ jsxRuntime.jsx(NewFileIcon, {}), action: () => startDraft(path, "file") },
          { label: t("Files_NewFolder"), icon: /* @__PURE__ */ jsxRuntime.jsx(NewFolderIcon, {}), action: () => startDraft(path, "dir") },
          { sep: true },
          { label: t("Files_Copy"), icon: /* @__PURE__ */ jsxRuntime.jsx(CopyIcon, {}), hint: "Ctrl+C", action: () => setClip({ path, isDir: true, cut: false }) },
          { label: t("Files_Cut"), icon: /* @__PURE__ */ jsxRuntime.jsx(CutIcon, {}), hint: "Ctrl+X", action: () => setClip({ path, isDir: true, cut: true }) },
          { label: t("Files_Paste"), icon: /* @__PURE__ */ jsxRuntime.jsx(PasteIcon, {}), hint: "Ctrl+V", disabled: !canPasteInto(clip, path), action: () => {
            if (clip) doPaste(clip, path);
          } },
          { sep: true },
          ...mutators ? [
            { label: t("Files_Rename"), icon: /* @__PURE__ */ jsxRuntime.jsx(PencilIcon, {}), hint: "F2", action: () => startRename(path, true) },
            { label: t("Files_Delete"), icon: /* @__PURE__ */ jsxRuntime.jsx(TrashIcon, {}), hint: "Del", action: () => setConfirmDel({ path, isDir: true }) },
            { sep: true }
          ] : [],
          { label: t("Files_RevealInExplorer"), icon: /* @__PURE__ */ jsxRuntime.jsx(RevealIcon, {}), action: () => reveal(path) },
          { label: t("Files_CopyPath"), icon: /* @__PURE__ */ jsxRuntime.jsx(CopyIcon, {}), action: () => void copyPath(path, true) }
        ];
      }
      const parent = parentOf(path);
      return [
        { label: t("Files_TreeOpen"), hint: "Enter", action: () => props.onOpenFile(path, { preview: false }) },
        { label: t("Files_ShowDiff"), icon: /* @__PURE__ */ jsxRuntime.jsx(DiffIcon, {}), action: () => {
          pageSdk.navigate("changes");
        } },
        { sep: true },
        { label: t("Files_NewFile"), icon: /* @__PURE__ */ jsxRuntime.jsx(NewFileIcon, {}), action: () => startDraft(parent, "file") },
        { label: t("Files_NewFolder"), icon: /* @__PURE__ */ jsxRuntime.jsx(NewFolderIcon, {}), action: () => startDraft(parent, "dir") },
        { sep: true },
        ...mutators ? [
          { label: t("Files_Rename"), icon: /* @__PURE__ */ jsxRuntime.jsx(PencilIcon, {}), hint: "F2", action: () => startRename(path, false) },
          { label: t("Files_Delete"), icon: /* @__PURE__ */ jsxRuntime.jsx(TrashIcon, {}), hint: "Del", action: () => setConfirmDel({ path, isDir: false }) },
          { sep: true }
        ] : [],
        { label: t("Files_Copy"), icon: /* @__PURE__ */ jsxRuntime.jsx(CopyIcon, {}), hint: "Ctrl+C", action: () => setClip({ path, isDir: false, cut: false }) },
        { label: t("Files_Cut"), icon: /* @__PURE__ */ jsxRuntime.jsx(CutIcon, {}), hint: "Ctrl+X", action: () => setClip({ path, isDir: false, cut: true }) },
        { label: t("Files_Paste"), icon: /* @__PURE__ */ jsxRuntime.jsx(PasteIcon, {}), hint: "Ctrl+V", disabled: !canPasteInto(clip, parent), action: () => {
          if (clip) doPaste(clip, parent);
        } },
        { sep: true },
        { label: t("Files_CopyName"), action: () => void copyText(path.split("/").pop() ?? path) },
        { label: t("Files_CopyPath"), icon: /* @__PURE__ */ jsxRuntime.jsx(CopyIcon, {}), action: () => void copyPath(path, true) },
        { label: t("Files_CopyRelPath"), action: () => void copyPath(path, false) },
        { sep: true },
        { label: t("Files_OpenInEditor"), icon: /* @__PURE__ */ jsxRuntime.jsx(OpenExternalIcon, {}), action: () => openExternal(path) },
        { label: t("Files_RevealInExplorer"), icon: /* @__PURE__ */ jsxRuntime.jsx(RevealIcon, {}), action: () => reveal(path) }
      ];
    }, [t, props.onOpenFile, props.onRename, props.onDelete, props.onPaste, copyPath, copyText, openExternal, reveal, startDraft, startRename, canPasteInto, clip, doPaste]);
    const bodyMenu = React$1.useCallback(() => [
      { label: t("Files_NewFile"), icon: /* @__PURE__ */ jsxRuntime.jsx(NewFileIcon, {}), action: () => startDraft("", "file") },
      { label: t("Files_NewFolder"), icon: /* @__PURE__ */ jsxRuntime.jsx(NewFolderIcon, {}), action: () => startDraft("", "dir") },
      { sep: true },
      { label: t("Files_Paste"), icon: /* @__PURE__ */ jsxRuntime.jsx(PasteIcon, {}), hint: "Ctrl+V", disabled: !canPasteInto(clip, ""), action: () => {
        if (clip) doPaste(clip, "");
      } }
    ], [t, startDraft, canPasteInto, clip, doPaste]);
    const handleContext = React$1.useCallback((e, node) => {
      setKbKey(false);
      setKbFocus(node.entry.path);
      showMenu(e, menuFor(node));
    }, [showMenu, menuFor]);
    const handleBodyContext = React$1.useCallback((e) => {
      if (e.target.closest(".files-row")) return;
      setKbKey(false);
      showMenu(e, bodyMenu());
    }, [showMenu, bodyMenu]);
    const handleKey = React$1.useCallback((e) => {
      var _a2;
      const nodes = nodesRef.current;
      if (nodes.length === 0) return;
      const idx = kbFocus ? nodes.findIndex((n) => n.entry.path === kbFocus) : -1;
      const focused = idx >= 0 ? nodes[idx] : null;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setKbKey(true);
        const next = nodes[Math.max(0, Math.min(nodes.length - 1, idx < 0 ? 0 : idx + (e.key === "ArrowDown" ? 1 : -1)))];
        setKbFocus(next.entry.path);
        setSelectedPath(next.entry.path);
        virtualizer.scrollToIndex(nodes.indexOf(next), { align: "auto" });
      } else if (e.key === "Enter" && idx >= 0) {
        e.preventDefault();
        const n = nodes[idx];
        if (n.draft) {
          (_a2 = draftInputRef.current) == null ? void 0 : _a2.focus();
          return;
        }
        if (n.entry.isDir) toggleDir(n.entry.path);
        else props.onOpenFile(n.entry.path, { preview: true });
      } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && idx >= 0) {
        const n = nodes[idx];
        if (!n.entry.isDir) return;
        const isOpen = forceOpen || !collapsed.has(n.entry.path);
        if (e.key === "ArrowRight" && !isOpen) toggleDir(n.entry.path);
        else if (e.key === "ArrowLeft" && isOpen && !forceOpen) toggleDir(n.entry.path);
      } else if (e.key === "F2" && focused && !focused.draft) {
        e.preventDefault();
        startRename(focused.entry.path, focused.entry.isDir);
      } else if (e.key === "Delete" && focused && !focused.draft) {
        e.preventDefault();
        setConfirmDel({ path: focused.entry.path, isDir: focused.entry.isDir });
      } else if ((e.ctrlKey || e.metaKey) && focused && !focused.draft && (e.key === "c" || e.key === "C" || e.key === "x" || e.key === "X")) {
        e.preventDefault();
        setClip({ path: focused.entry.path, isDir: focused.entry.isDir, cut: e.key.toLowerCase() === "x" });
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V") && clip) {
        e.preventDefault();
        const toDir = focused ? focused.entry.isDir ? focused.entry.path : focused.entry.path.includes("/") ? focused.entry.path.slice(0, focused.entry.path.lastIndexOf("/")) : "" : "";
        if (canPasteInto(clip, toDir)) doPaste(clip, toDir);
      }
    }, [kbFocus, virtualizer, toggleDir, props.onOpenFile, forceOpen, collapsed, startRename, clip, canPasteInto, doPaste]);
    const highlight = React$1.useCallback((name) => {
      if (!q) return name;
      const i = name.toLowerCase().indexOf(q);
      if (i < 0) return name;
      return /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        name.slice(0, i),
        /* @__PURE__ */ jsxRuntime.jsx("mark", { children: name.slice(i, i + q.length) }),
        name.slice(i + q.length)
      ] });
    }, [q]);
    const rows = virtualizer.getVirtualItems().map((vi) => {
      const node = visibleNodes[vi.index];
      const { entry, depth } = node;
      const guides = [];
      for (let d = 0; d < depth; d++) {
        guides.push(/* @__PURE__ */ jsxRuntime.jsx("i", { className: "files-guide", style: { left: 14 + 16 * d } }, d));
      }
      const rowStyle = { transform: `translateY(${vi.start}px)`, paddingLeft: 6 + depth * 16 };
      if (node.draft) {
        return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "files-row draft", style: rowStyle, children: [
          guides,
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "files-fico", children: node.entry.isDir ? /* @__PURE__ */ jsxRuntime.jsx(FolderIcon, {}) : /* @__PURE__ */ jsxRuntime.jsx(FileIcon, { path: draftName || "x" }) }),
          /* @__PURE__ */ jsxRuntime.jsx(
            "input",
            {
              ref: draftInputRef,
              className: "files-draft-input",
              value: draftName,
              placeholder: t("Files_NewNamePlaceholder"),
              title: (draft == null ? void 0 : draft.dir) || "/",
              spellCheck: false,
              draggable: false,
              onChange: (e) => setDraftName(e.target.value),
              onKeyDown: (e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  void commitDraft();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setDraft(null);
                }
              },
              onBlur: () => setDraft(null)
            }
          )
        ] }, DRAFT_PATH);
      }
      const isActive = entry.path === props.activePath || entry.isDir && selectedPath === entry.path;
      const statusCls = entry.status ? STATUS_CLS$1[entry.status] ?? "" : "";
      const isAgent = !entry.isDir && entry.touchedByAgent;
      const nameCls = "files-nm" + (entry.isDir && node.dirStatus ? ` ${STATUS_CLS$1[node.dirStatus]}` : "") + (!entry.isDir && entry.status ? ` ${statusCls}` : "");
      const isDropDir = entry.isDir && dropTarget === entry.path;
      return /* @__PURE__ */ jsxRuntime.jsxs(
        "div",
        {
          className: "files-row" + (entry.isDir && node.open ? " open" : "") + (isActive ? " active" : "") + (isAgent ? " agent" : "") + (kbKey && entry.path === kbFocus ? " kb-focus" : "") + (isDropDir ? " drop-target" : "") + ((dragItem == null ? void 0 : dragItem.path) === entry.path ? " dragging" : ""),
          style: rowStyle,
          title: entry.path,
          draggable: true,
          onDragStart: (e) => {
            e.dataTransfer.setData("text/gitter-tree", entry.path);
            e.dataTransfer.effectAllowed = "move";
            setDragItem({ path: entry.path, isDir: entry.isDir });
          },
          onDragEnd: () => {
            setDragItem(null);
            setDropTarget(null);
          },
          onDragOver: (e) => {
            if (!entry.isDir || !dragItem) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (dropTarget !== entry.path) setDropTarget(entry.path);
          },
          onDragLeave: (e) => {
            if (entry.isDir && dropTarget === entry.path) setDropTarget(null);
          },
          onDrop: (e) => {
            if (!entry.isDir) return;
            e.preventDefault();
            e.stopPropagation();
            dropMove(entry.path);
          },
          onClick: () => {
            setKbKey(false);
            setKbFocus(entry.path);
            setSelectedPath(entry.path);
            if (entry.isDir) {
              if (mode === "all" && !q) toggleDir(entry.path);
            } else {
              props.onOpenFile(entry.path, { preview: true });
            }
          },
          onDoubleClick: () => {
            if (!entry.isDir) props.onOpenFile(entry.path, { preview: false });
          },
          onContextMenu: (e) => handleContext(e, node),
          children: [
            guides,
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "files-chev", children: entry.isDir ? /* @__PURE__ */ jsxRuntime.jsx(ChevronIcon, {}) : null }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "files-fico", children: entry.isDir ? /* @__PURE__ */ jsxRuntime.jsx(FolderIcon, {}) : /* @__PURE__ */ jsxRuntime.jsx(FileIcon, { path: entry.path }) }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: nameCls, children: highlight(entry.path.split("/").pop() ?? entry.path) }),
            isAgent && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "files-spark", title: t("Files_AgentTouched"), children: /* @__PURE__ */ jsxRuntime.jsx(SparkIcon, {}) }),
            !entry.isDir && entry.status && /* @__PURE__ */ jsxRuntime.jsx("span", { className: `files-st ${statusCls}`, children: STATUS_LETTER$1[entry.status] ?? entry.status })
          ]
        },
        entry.path
      );
    });
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "files-pane", children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "files-head", children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "files-mtabs", role: "tablist", children: ["all", "git"].map((m) => /* @__PURE__ */ jsxRuntime.jsxs(
          "button",
          {
            role: "tab",
            "aria-selected": mode === m,
            title: t(m === "git" ? "Files_ModeChanges" : "Files_ModeAll"),
            className: "files-mtab" + (mode === m ? " on" : ""),
            onClick: () => {
              var _a2;
              setMode(m);
              (_a2 = props.onModeChange) == null ? void 0 : _a2.call(props, m);
            },
            children: [
              m === "all" ? /* @__PURE__ */ jsxRuntime.jsx(FolderIcon, { size: 13 }) : /* @__PURE__ */ jsxRuntime.jsx(PencilIcon, {}),
              m === "git" && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "n", children: counts.git })
            ]
          },
          m
        )) }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "files-hacts", children: [
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "files-ibtn", title: t("Files_NewFile"), onClick: () => startDraft(selectedDir(), "file"), children: /* @__PURE__ */ jsxRuntime.jsx(NewFileIcon, {}) }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "files-ibtn", title: t("Files_NewFolder"), onClick: () => startDraft(selectedDir(), "dir"), children: /* @__PURE__ */ jsxRuntime.jsx(NewFolderIcon, {}) }),
          /* @__PURE__ */ jsxRuntime.jsx(
            "button",
            {
              className: "files-ibtn" + (filterOn ? " on" : ""),
              title: t("Files_FilterToggle"),
              onClick: () => {
                setFilterOn((v) => {
                  const next = !v;
                  if (!next) setQuery("");
                  else setTimeout(() => {
                    var _a2;
                    return (_a2 = filterInputRef.current) == null ? void 0 : _a2.focus();
                  }, 0);
                  return next;
                });
              },
              children: /* @__PURE__ */ jsxRuntime.jsx(FilterIcon, {})
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "files-ibtn", title: t("Files_Refresh"), onClick: props.onRefresh, children: /* @__PURE__ */ jsxRuntime.jsx(RefreshIcon, {}) }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "files-ibtn", title: t("Files_ExpandAll"), onClick: () => setCollapsed(/* @__PURE__ */ new Set()), children: /* @__PURE__ */ jsxRuntime.jsx(ExpandAllIcon, {}) }),
          /* @__PURE__ */ jsxRuntime.jsx(
            "button",
            {
              className: "files-ibtn",
              title: t("Files_CollapseAll"),
              onClick: () => setCollapsed(new Set(visibleNodes.filter((n) => n.entry.isDir && !n.draft).map((n) => n.entry.path))),
              children: /* @__PURE__ */ jsxRuntime.jsx(CollapseAllIcon, {})
            }
          )
        ] })
      ] }),
      filterOn && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "files-filter", children: [
        /* @__PURE__ */ jsxRuntime.jsx(
          "input",
          {
            ref: filterInputRef,
            type: "text",
            placeholder: t("Files_SearchPlaceholder"),
            value: query,
            spellCheck: false,
            onChange: (e) => setQuery(e.target.value),
            onKeyDown: (e) => {
              if (e.key === "Escape") {
                setQuery("");
                setFilterOn(false);
              }
            }
          }
        ),
        q && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "files-fcount", children: t("Files_FilterMatches", files.length) }),
        /* @__PURE__ */ jsxRuntime.jsx(
          "button",
          {
            className: "files-ibtn",
            style: { width: 20, height: 20 },
            title: t("Common_Cancel"),
            onClick: () => {
              setQuery("");
              setFilterOn(false);
            },
            children: /* @__PURE__ */ jsxRuntime.jsx(CloseIcon, {})
          }
        )
      ] }),
      /* @__PURE__ */ jsxRuntime.jsx(
        "div",
        {
          ref: parentRef,
          className: "files-tree",
          role: "tree",
          tabIndex: 0,
          onKeyDown: handleKey,
          onContextMenu: handleBodyContext,
          onDragOver: (e) => {
            if (!dragItem) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          },
          onDrop: (e) => {
            if (!dragItem) return;
            e.preventDefault();
            dropMove("");
          },
          onDragEnd: () => {
            setDragItem(null);
            setDropTarget(null);
          },
          children: props.loading && visibleNodes.length === 0 ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "files-empty", children: "Loading…" }) : visibleNodes.length === 0 ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "files-empty", children: t("Files_NoMatch") }) : /* @__PURE__ */ jsxRuntime.jsx("div", { style: { height: virtualizer.getTotalSize(), position: "relative" }, children: rows })
        }
      ),
      menuElement,
      confirmDel && /* @__PURE__ */ jsxRuntime.jsxs(
        Modal,
        {
          title: t("Files_DeleteConfirmTitle"),
          danger: true,
          confirmText: t("Files_Delete"),
          onClose: () => setConfirmDel(null),
          onConfirm: () => {
            var _a2;
            const d = confirmDel;
            setConfirmDel(null);
            void ((_a2 = props.onDelete) == null ? void 0 : _a2.call(props, d.path, d.isDir));
          },
          children: [
            /* @__PURE__ */ jsxRuntime.jsx("div", { children: t("Files_DeleteConfirmBody", confirmDel.path) }),
            confirmDel.isDir && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { marginTop: 6, opacity: 0.72 }, children: t("Files_DeleteConfirmDir") })
          ]
        }
      )
    ] });
  }
  const lib = (_c = window.GITTER_LIBS) == null ? void 0 : _c.monaco;
  if (!lib) {
    throw new Error("GITTER_LIBS.monaco 未注册——gitui.lib.monaco 库未装载（loader 依赖序保证不应发生）");
  }
  const NAMESPACE_MEMBERS = [
    "editor",
    "languages",
    "Uri",
    "Position",
    "Range",
    "Selection",
    "Token",
    "KeyCode",
    "KeyMod",
    "MarkerSeverity",
    "MarkerTag"
  ];
  for (const k of NAMESPACE_MEMBERS) {
    if (!(k in lib)) throw new Error(`GITTER_LIBS.monaco 缺少顶层成员 ${k}——monacoLibAccess 导出面需跟进（库版本变化？）`);
  }
  const editor = lib.editor;
  const languages = lib.languages;
  const Uri = lib.Uri;
  lib.Position;
  const Range = lib.Range;
  lib.Selection;
  lib.Token;
  lib.KeyCode;
  lib.KeyMod;
  const MarkerSeverity = lib.MarkerSeverity;
  lib.MarkerTag;
  const EXT_TO_LANG = {
    // JavaScript 生态（TS 语言服务：补全 + 诊断）
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".jsx": "javascript",
    ".json": "json",
    ".jsonc": "json",
    // 样式与标记
    ".css": "css",
    ".scss": "css",
    ".less": "css",
    ".html": "html",
    ".htm": "html",
    ".vue": "html",
    ".svelte": "html",
    // C# 生态（app 侧 highlighters 覆盖面）
    ".cs": "csharp",
    ".csx": "csharp",
    ".xml": "xml",
    ".xaml": "xml",
    ".csproj": "xml",
    ".props": "xml",
    ".targets": "xml",
    ".config": "xml",
    // 脚本与系统
    ".ps1": "powershell",
    ".psm1": "powershell",
    ".psd1": "powershell",
    ".sh": "shell",
    ".bash": "shell",
    ".zsh": "shell",
    ".bat": "bat",
    ".cmd": "bat",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".hpp": "cpp",
    ".cc": "cpp",
    ".rb": "ruby",
    ".php": "php",
    ".swift": "swift",
    ".scala": "scala",
    // AuraLang 生态（Monarch 定义在 web/src/libs/monarch/；Monarch 注册在 monacoLib.ts）
    ".aura": "aura",
    ".hat": "hat",
    // 标记与配置
    ".md": "markdown",
    ".markdown": "markdown",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".toml": "ini",
    ".ini": "ini",
    ".cfg": "ini",
    ".properties": "ini",
    ".editorconfig": "ini",
    ".svg": "xml",
    ".sln": "ini",
    ".txt": "plaintext",
    ".log": "plaintext",
    ".gitignore": "plaintext"
  };
  function languageForPath(path) {
    const base = path.split("/").pop() ?? path;
    const dot = base.lastIndexOf(".");
    if (dot <= 0) return "plaintext";
    const ext = base.slice(dot).toLowerCase();
    return EXT_TO_LANG[ext] ?? "plaintext";
  }
  const TS_COMPILER_OPTIONS = {
    target: 99,
    // Latest
    module: 99,
    // ESNext
    // NodeJs 解析（追加 .ts 后缀找相对导入）；monaco 独立宿主下 Bundler 档无效
    moduleResolution: 2,
    allowNonTsExtensions: true,
    allowJs: true,
    strict: false,
    noEmit: true,
    jsx: 1
    // Preserve
  };
  languages.typescript.typescriptDefaults.setCompilerOptions(TS_COMPILER_OPTIONS);
  languages.typescript.javascriptDefaults.setCompilerOptions(TS_COMPILER_OPTIONS);
  languages.typescript.typescriptDefaults.setEagerModelSync(true);
  languages.typescript.javascriptDefaults.setEagerModelSync(true);
  languages.typescript.typescriptDefaults.setDiagnosticsOptions({ diagnosticCodesToIgnore: [6133] });
  languages.typescript.javascriptDefaults.setDiagnosticsOptions({ diagnosticCodesToIgnore: [6133] });
  const EDITOR_OPTIONS = {
    fontSize: 13,
    lineHeight: 1.5 * 13,
    fontFamily: "'Cascadia Code', 'Fira Code', 'Cascadia Mono', Consolas, monospace",
    tabSize: 4,
    insertSpaces: true,
    minimap: { enabled: true },
    wordWrap: "off",
    scrollBeyondLastLine: false,
    automaticLayout: true,
    bracketPairColorization: { enabled: true },
    renderWhitespace: "selection",
    padding: { top: 8, bottom: 8 },
    // P4.2 多光标编辑体验：Alt+点击加光标 / Ctrl+Alt+↑↓ 加上下光标（Monaco 原生能力，
    // 这里只显式固定修饰键与动效——平滑光标/滚动、关闭无障碍层的高频 aria 重排）
    multiCursorModifier: "alt",
    cursorSmoothCaretAnimation: "on",
    smoothScrolling: true,
    accessibilitySupport: "off"
  };
  const THEME_DARK = "gitter-dark";
  const THEME_LIGHT = "gitter-light";
  function buildTheme(theme) {
    var _a2, _b2, _c2, _d, _e, _f, _g;
    const dark = theme.base !== "light";
    const rules = [];
    const colors = {};
    for (const [style, color] of Object.entries(theme.syntax ?? {})) {
      rules.push({ token: style, foreground: color });
    }
    colors["editor.background"] = ((_a2 = theme.tokens) == null ? void 0 : _a2.Base) ?? (dark ? "#0D0D0D" : "#FFFFFF");
    colors["editor.foreground"] = ((_b2 = theme.tokens) == null ? void 0 : _b2.Text) ?? (dark ? "#EAEAEA" : "#1B1B1B");
    colors["editor.lineHighlightBackground"] = dark ? "#ffffff0a" : "#0000000a";
    colors["editorLineNumber.foreground"] = ((_c2 = theme.tokens) == null ? void 0 : _c2.Text3) ?? (dark ? "#6E6E6E" : "#8F8F8F");
    colors["editorLineNumber.activeForeground"] = ((_d = theme.tokens) == null ? void 0 : _d.Text2) ?? (dark ? "#A0A0A0" : "#5C5C5C");
    colors["editorCursor.foreground"] = ((_e = theme.tokens) == null ? void 0 : _e.Text) ?? (dark ? "#EAEAEA" : "#1B1B1B");
    colors["editor.selectionBackground"] = ((_f = theme.tokens) == null ? void 0 : _f.Link) ? theme.tokens.Link + "4D" : dark ? "#264f7880" : "#cfe1f580";
    colors["editor.selectionHighlightBackground"] = ((_g = theme.tokens) == null ? void 0 : _g.Link) ? theme.tokens.Link + "29" : dark ? "#3a3f4b40" : "#cfe1f540";
    colors["editorWhitespace.foreground"] = dark ? "#6a6a6a40" : "#8f8f8f30";
    return { base: dark ? "vs-dark" : "vs", inherit: true, rules, colors };
  }
  const LANG_LABEL = {
    typescript: "TypeScript",
    javascript: "JavaScript",
    json: "JSON",
    css: "CSS",
    html: "HTML",
    csharp: "C#",
    xml: "XML",
    powershell: "PowerShell",
    shell: "Shell",
    bat: "Batch",
    python: "Python",
    go: "Go",
    rust: "Rust",
    java: "Java",
    kotlin: "Kotlin",
    c: "C",
    cpp: "C++",
    ruby: "Ruby",
    php: "PHP",
    swift: "Swift",
    scala: "Scala",
    markdown: "Markdown",
    yaml: "YAML",
    ini: "INI",
    plaintext: "Plain Text"
  };
  function languageLabel(lang) {
    return LANG_LABEL[lang] ?? lang;
  }
  function markerCounts(model) {
    const m = model;
    if (!m) return { errors: 0, warnings: 0 };
    const markers = editor.getModelMarkers({ resource: m.uri });
    let errors = 0;
    let warnings = 0;
    for (const mk of markers) {
      if (mk.severity === MarkerSeverity.Error) errors++;
      else if (mk.severity === MarkerSeverity.Warning) warnings++;
    }
    return { errors, warnings };
  }
  function applyMonacoTheme(theme) {
    const t = theme ?? { base: "dark" };
    const name = t.base === "light" ? THEME_LIGHT : THEME_DARK;
    editor.defineTheme(name, buildTheme(t));
    editor.setTheme(name);
  }
  function createTextModel(path, value) {
    const uri = Uri.file(path.replace(/\\/g, "/"));
    return editor.getModel(uri) ?? editor.createModel(value, languageForPath(path), uri);
  }
  const viewStates = /* @__PURE__ */ new Map();
  function saveViewState(model, vs) {
    viewStates.set(model.id, vs);
  }
  function viewStateOf(model) {
    return viewStates.get(model.id);
  }
  const positions = /* @__PURE__ */ new Map();
  function savePosition(model, line, col) {
    try {
      const text = model.getLineContent(Math.max(1, line)) ?? "";
      positions.set(model.id, { line, col, text });
    } catch {
    }
  }
  function createEditor(host, overrides) {
    return editor.create(host, { ...EDITOR_OPTIONS, ...overrides });
  }
  function disposeTextModel(model) {
    var _a2;
    const m = model;
    if (m && typeof m.id === "string") {
      viewStates.delete(m.id);
      positions.delete(m.id);
    }
    (_a2 = model == null ? void 0 : model.dispose) == null ? void 0 : _a2.call(model);
  }
  function onAnyMarkers(cb) {
    return editor.onDidChangeMarkers(() => cb());
  }
  function markersOf(model) {
    const m = model;
    if (!m || m.isDisposed()) return [];
    return editor.getModelMarkers({ resource: m.uri });
  }
  function pathOfModel(model) {
    const m = model;
    if (!m || m.isDisposed()) return null;
    try {
      return m.uri.path.replace(/^\/+/, "");
    } catch {
      return null;
    }
  }
  function detectIndent(text) {
    let tabs = 0;
    let s2 = 0;
    let s4 = 0;
    for (const line of text.split("\n").slice(0, 200)) {
      if (/^\t+/.test(line)) tabs++;
      else if (/^ {2}/.test(line)) {
        if (/^ {4}/.test(line)) s4++;
        else s2++;
      }
    }
    if (tabs > s2 + s4) return { insertSpaces: false, tabSize: 4 };
    return { insertSpaces: true, tabSize: s4 >= s2 ? 4 : 2 };
  }
  const blameCache = /* @__PURE__ */ new Map();
  const BLAME_TTL = 3e4;
  function blameOfPath(path) {
    const hit = blameCache.get(path);
    if (hit && Date.now() - hit.at < BLAME_TTL) return hit.lines;
    void pageSdk.call("git.blame", { path }).then((lines) => {
      if (Array.isArray(lines)) blameCache.set(path, { at: Date.now(), lines });
    }).catch(() => {
    });
    return (hit == null ? void 0 : hit.lines) ?? [];
  }
  languages.registerHoverProvider("*", {
    provideHover: (model, position) => {
      const path = pathOfModel(model);
      if (!path) return null;
      const lines = blameOfPath(path);
      if (lines.length === 0) return null;
      const info = lines[position.lineNumber - 1];
      if (!info || /^0+$/.test(info.sha)) return null;
      const when = info.time ? new Date(info.time * 1e3).toLocaleDateString() : "";
      return {
        contents: [
          { value: `**${info.author || "?"}** · ${when} · \`${info.sha.slice(0, 7)}\`` },
          ...info.summary ? [{ value: info.summary.replace(/[\n\r]/g, " ") }] : []
        ]
      };
    }
  });
  try {
    applyMonacoTheme(pageSdk.theme());
  } catch {
    applyMonacoTheme(null);
  }
  window.__gitterMonacoEditor = editor;
  const MAX_DIFF_LINES = 2e4;
  const MAX_EDIT_DISTANCE = 4e3;
  function diffBlocks(a, b) {
    let pre = 0;
    while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    let aEnd = a.length;
    let bEnd = b.length;
    while (aEnd > pre && bEnd > pre && a[aEnd - 1] === b[bEnd - 1]) {
      aEnd--;
      bEnd--;
    }
    const as = a.slice(pre, aEnd);
    const bs = b.slice(pre, bEnd);
    if (as.length === 0 && bs.length === 0) return [];
    if (as.length === 0) return [{ aStart: pre, aEnd: pre, bStart: pre, bEnd: pre + bs.length }];
    if (bs.length === 0) return [{ aStart: pre, aEnd, bStart: pre, bEnd: pre }];
    const spans = myersSpans(as, bs);
    const shifted = spans.map((s) => ({
      aStart: s.aStart + pre,
      aEnd: s.aEnd + pre,
      bStart: s.bStart + pre,
      bEnd: s.bEnd + pre
    }));
    const merged = [];
    for (const s of shifted) {
      const last = merged[merged.length - 1];
      if (last && last.aEnd === s.aStart && last.bEnd === s.bStart) {
        last.aEnd = s.aEnd;
        last.bEnd = s.bEnd;
      } else {
        merged.push({ ...s });
      }
    }
    return merged;
  }
  function myersSpans(as, bs) {
    const n = as.length;
    const m = bs.length;
    const max = n + m;
    if (max > MAX_EDIT_DISTANCE * 2) {
      return [{ aStart: 0, aEnd: n, bStart: 0, bEnd: m }];
    }
    const offset = max;
    const v = new Int32Array(2 * max + 1);
    const trace = [];
    let found = false;
    for (let d = 0; d <= max && !found; d++) {
      trace.push(v.slice());
      for (let k = -d; k <= d; k += 2) {
        let x2;
        if (k === -d || k !== d && v[k - 1 + offset] < v[k + 1 + offset]) x2 = v[k + 1 + offset];
        else x2 = v[k - 1 + offset] + 1;
        let y2 = x2 - k;
        while (x2 < n && y2 < m && as[x2] === bs[y2]) {
          x2++;
          y2++;
        }
        v[k + offset] = x2;
        if (x2 >= n && y2 >= m) {
          found = true;
          break;
        }
      }
    }
    const spans = [];
    let x = n;
    let y = m;
    for (let d = trace.length - 1; d >= 0; d--) {
      const vd = trace[d];
      const k = x - y;
      let prevK;
      if (k === -d || k !== d && vd[k - 1 + offset] < vd[k + 1 + offset]) prevK = k + 1;
      else prevK = k - 1;
      const prevX = vd[prevK + offset];
      const prevY = prevX - prevK;
      while (x > prevX && y > prevY) {
        x--;
        y--;
      }
      if (d > 0) {
        if (x > prevX) spans.push({ aStart: prevX, aEnd: x, bStart: y, bEnd: y });
        else spans.push({ aStart: x, aEnd: x, bStart: prevY, bEnd: y });
      }
      x = prevX;
      y = prevY;
    }
    return spans.reverse();
  }
  const decorationsByModel = /* @__PURE__ */ new WeakMap();
  const MAX_HOVER_LINES = 60;
  function updateGitGutter(model, base) {
    const old = decorationsByModel.get(model) ?? [];
    if (base === null) {
      if (old.length > 0) model.deltaDecorations(old, []);
      decorationsByModel.delete(model);
      return { count: 0, anchors: [] };
    }
    const a = base.split("\n");
    const b = model.getValue().split("\n");
    let decos = [];
    const anchors = [];
    if (a.length + b.length <= MAX_DIFF_LINES) {
      for (const block of diffBlocks(a, b)) {
        anchors.push(block.bEnd > block.bStart ? block.bStart + 1 : Math.min(block.bStart + 1, b.length));
        const delLines = block.aEnd > block.aStart ? a.slice(block.aStart, Math.min(block.aEnd, block.aStart + MAX_HOVER_LINES)) : null;
        const hover = delLines ? {
          value: "```\n" + delLines.join("\n") + (block.aEnd - block.aStart > MAX_HOVER_LINES ? "\n…" : "") + "\n```"
        } : void 0;
        if (block.bEnd > block.bStart) {
          decos.push({
            range: new Range(block.bStart + 1, 1, block.bEnd, 1),
            options: { isWholeLine: true, className: "gg-line-add", hoverMessage: hover }
          });
        } else if (hover) {
          const line = Math.min(block.bStart + 1, model.getLineCount());
          decos.push({
            range: new Range(line, 1, line, 1),
            options: { isWholeLine: true, className: "gg-line-del", hoverMessage: hover }
          });
        }
      }
    }
    decorationsByModel.set(model, model.deltaDecorations(old, decos));
    return { count: decos.length, anchors };
  }
  const FONT_KEY = "gitter.files.fontSize";
  const FONT_MIN = 9;
  const FONT_MAX = 32;
  const revealedKeys = /* @__PURE__ */ new Set();
  function loadFontSize() {
    const n = Number(window.localStorage.getItem(FONT_KEY));
    return Number.isFinite(n) && n >= FONT_MIN && n <= FONT_MAX ? n : 13;
  }
  const FilesMonacoEditor = React$1.forwardRef(
    function FilesMonacoEditor2(props, ref) {
      var _a2, _b2;
      const hostRef = React$1.useRef(null);
      const edRef = React$1.useRef(null);
      const fontSizeRef = React$1.useRef(loadFontSize());
      const anchorsRef = React$1.useRef([]);
      const cbRef = React$1.useRef(props);
      cbRef.current = props;
      const reportDiff = () => {
        var _a3, _b3, _c2;
        const ed = edRef.current;
        const cur = ((_a3 = ed == null ? void 0 : ed.getPosition()) == null ? void 0 : _a3.lineNumber) ?? 1;
        const anchors = anchorsRef.current;
        let index = 0;
        for (const l of anchors) {
          if (l > cur) break;
          index++;
        }
        (_c2 = (_b3 = cbRef.current).onDiffProgress) == null ? void 0 : _c2.call(_b3, index, anchors.length);
      };
      const applyGutter = () => {
        const ed = edRef.current;
        const m = ed == null ? void 0 : ed.getModel();
        if (!ed || !m) return;
        const r = updateGitGutter(m, cbRef.current.showDiff ? cbRef.current.gitBase ?? null : null);
        anchorsRef.current = r.anchors;
        reportDiff();
      };
      const theme = useAppState().theme;
      React$1.useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const ed = createEditor(host, { fontSize: fontSizeRef.current });
        edRef.current = ed;
        return () => {
          const m = ed.getModel();
          if (m) {
            const vs = ed.saveViewState();
            if (vs) saveViewState(m, vs);
            const p = ed.getPosition();
            if (p) savePosition(m, p.lineNumber, p.column);
          }
          ed.dispose();
          edRef.current = null;
        };
      }, []);
      React$1.useEffect(() => {
        applyMonacoTheme(theme);
      }, [theme]);
      React$1.useEffect(() => {
        var _a3;
        (_a3 = edRef.current) == null ? void 0 : _a3.updateOptions({ readOnly: !!props.readOnly });
      }, [props.readOnly]);
      const applyFont = (px) => {
        var _a3;
        const next = Math.min(FONT_MAX, Math.max(FONT_MIN, px));
        fontSizeRef.current = next;
        window.localStorage.setItem(FONT_KEY, String(next));
        (_a3 = edRef.current) == null ? void 0 : _a3.updateOptions({ fontSize: next });
      };
      React$1.useEffect(() => {
        const host = hostRef.current;
        const onWheel = (e) => {
          if (!(e.ctrlKey || e.metaKey)) return;
          e.preventDefault();
          applyFont(fontSizeRef.current + (e.deltaY < 0 ? 1 : -1));
        };
        const onKey = (e) => {
          if (!cbRef.current.ownsKeys) return;
          if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
          if (e.key === "=" || e.key === "+") {
            e.preventDefault();
            applyFont(fontSizeRef.current + 1);
          } else if (e.key === "-") {
            e.preventDefault();
            applyFont(fontSizeRef.current - 1);
          } else if (e.key === "0") {
            e.preventDefault();
            applyFont(13);
          }
        };
        host == null ? void 0 : host.addEventListener("wheel", onWheel, { passive: false });
        window.addEventListener("keydown", onKey);
        return () => {
          host == null ? void 0 : host.removeEventListener("wheel", onWheel);
          window.removeEventListener("keydown", onKey);
        };
      }, []);
      React$1.useEffect(() => {
        const ed = edRef.current;
        const r = props.revealLine;
        if (!ed || !r || !props.model) return;
        ed.revealLineInCenter(r.line);
        ed.setPosition({ lineNumber: r.line, column: 1 });
        ed.focus();
      }, [(_a2 = props.revealLine) == null ? void 0 : _a2.ts, props.model]);
      React$1.useEffect(() => {
        var _a3, _b3;
        const ed = edRef.current;
        const r = props.initialReveal;
        if (!ed || !r || !props.model) return;
        const model = props.model;
        const key = `${model.id}:${r.ts}`;
        if (revealedKeys.has(key)) return;
        revealedKeys.add(key);
        const line = Math.max(1, Math.min(r.line, model.getLineCount() || r.line));
        const col = Math.max(1, Math.min(r.col, model.getLineMaxColumn(line) || r.col));
        ed.revealLineInCenter(line);
        ed.setPosition({ lineNumber: line, column: col });
        const pos = ed.getPosition();
        if (pos) {
          (_b3 = (_a3 = cbRef.current).onPosition) == null ? void 0 : _b3.call(_a3, { line: pos.lineNumber, col: pos.column });
          savePosition(model, pos.lineNumber, pos.column);
        }
      }, [(_b2 = props.initialReveal) == null ? void 0 : _b2.ts, props.model]);
      React$1.useImperativeHandle(ref, () => ({
        runAction: (actionId) => {
          const ed = edRef.current;
          if (!ed) return false;
          const a = ed.getAction(actionId);
          if (!a) return false;
          a.run();
          return true;
        },
        jumpDiff: (dir) => {
          var _a3;
          const ed = edRef.current;
          if (!ed) return false;
          const anchors = anchorsRef.current;
          if (anchors.length === 0) return false;
          const cur = ((_a3 = ed.getPosition()) == null ? void 0 : _a3.lineNumber) ?? 1;
          const line = dir > 0 ? anchors.find((l) => l > cur) ?? anchors[0] : [...anchors].reverse().find((l) => l < cur) ?? anchors[anchors.length - 1];
          ed.revealLineInCenter(line);
          ed.setPosition({ lineNumber: line, column: 1 });
          ed.focus();
          return true;
        },
        fontSize: () => fontSizeRef.current
      }), []);
      React$1.useEffect(() => {
        var _a3, _b3, _c2, _d;
        const ed = edRef.current;
        if (!ed) return;
        const prev = ed.getModel();
        if (prev) {
          const vs = ed.saveViewState();
          if (vs) saveViewState(prev, vs);
          const p = ed.getPosition();
          if (p) savePosition(prev, p.lineNumber, p.column);
        }
        const model = props.model;
        const incoming = model ? viewStateOf(model) : void 0;
        ed.setModel(model);
        if (model) {
          if (incoming) ed.restoreViewState(incoming);
          ed.focus();
        }
        const pos = ed.getPosition();
        if (pos) (_b3 = (_a3 = cbRef.current).onPosition) == null ? void 0 : _b3.call(_a3, { line: pos.lineNumber, col: pos.column });
        (_d = (_c2 = cbRef.current).onMarkers) == null ? void 0 : _d.call(_c2, markerCounts(model));
        const sub = ed.onDidChangeModelContent((e) => {
          var _a4, _b4;
          if (e.isFlush) return;
          (_b4 = (_a4 = cbRef.current).onChange) == null ? void 0 : _b4.call(_a4, model ? model.getValue() : "");
        });
        let gutterTimer = 0;
        const rerunGutter = () => {
          window.clearTimeout(gutterTimer);
          gutterTimer = window.setTimeout(applyGutter, 250);
        };
        if (model) applyGutter();
        const subGutter = model ? model.onDidChangeContent(rerunGutter) : null;
        return () => {
          sub.dispose();
          subGutter == null ? void 0 : subGutter.dispose();
          window.clearTimeout(gutterTimer);
        };
      }, [props.model]);
      React$1.useEffect(() => {
        applyGutter();
      }, [props.gitBase, props.showDiff]);
      React$1.useEffect(() => {
        const ed = edRef.current;
        if (!ed) return;
        const reportMarkers = () => {
          var _a3, _b3;
          return (_b3 = (_a3 = cbRef.current).onMarkers) == null ? void 0 : _b3.call(_a3, markerCounts(ed.getModel()));
        };
        const d1 = ed.onDidChangeCursorPosition((e) => {
          var _a3, _b3;
          const m = ed.getModel();
          if (m) savePosition(m, e.position.lineNumber, e.position.column);
          (_b3 = (_a3 = cbRef.current).onPosition) == null ? void 0 : _b3.call(_a3, { line: e.position.lineNumber, col: e.position.column });
          reportDiff();
        });
        const d2 = editor.onDidChangeMarkers(reportMarkers);
        return () => {
          d1.dispose();
          d2.dispose();
        };
      }, []);
      return /* @__PURE__ */ jsxRuntime.jsx("div", { ref: hostRef, style: { width: "100%", height: "100%", position: "relative" } });
    }
  );
  function serverKeyOf(languageId) {
    if (languageId === "typescript" || languageId === "javascript") return "typescript";
    if (languageId === "python") return "python";
    return null;
  }
  const SETTINGS_OF_SERVER = {
    typescript: { enabled: "lspTypescript", command: "lspTypescriptCommand", fallback: "typescript-language-server --stdio" },
    python: { enabled: "lspPython", command: "lspPythonCommand", fallback: "pyright-langserver --stdio" }
  };
  function pathToUri(path) {
    const norm = path.replace(/\\/g, "/").replace(/^\/+/, "");
    return `file:///${norm}`;
  }
  function uriToPath(uri) {
    try {
      let p = decodeURIComponent(uri.replace(/^file:\/\//i, "")).replace(/\\/g, "/");
      p = p.replace(/^([A-Za-z]):/, (_m, d) => d.toUpperCase() + ":");
      return p;
    } catch {
      return uri;
    }
  }
  function markerSeverity(sev) {
    return Math.min(Math.max(sev ?? 2, 1), 4);
  }
  const docs = /* @__PURE__ */ new Map();
  const startState = /* @__PURE__ */ new Map();
  const startPromises = /* @__PURE__ */ new Map();
  let providersRegistered = false;
  let eventSubscribed = false;
  function ensureEventSubscription() {
    if (eventSubscribed) return;
    eventSubscribed = true;
    pageSdk.on("lsp.event", (raw) => {
      const p = raw;
      if (!p || p.method !== "textDocument/publishDiagnostics") return;
      const params = p.params;
      const doc = docs.get(uriToPath(params.uri));
      if (!doc || doc.model.isDisposed()) return;
      const markers = (params.diagnostics ?? []).map((d) => ({
        severity: markerSeverity(d.severity),
        message: d.message,
        source: p.language,
        startLineNumber: d.range.start.line + 1,
        startColumn: d.range.start.character + 1,
        endLineNumber: d.range.end.line + 1,
        endColumn: d.range.end.character + 1
      }));
      editor.setModelMarkers(doc.model, "lsp", markers);
    });
  }
  function serverConfig(serverKey) {
    const cfg = SETTINGS_OF_SERVER[serverKey];
    if (!cfg) return null;
    const s = pageSdk.settings();
    if (!s || s[cfg.enabled] !== true) return null;
    const command = typeof s[cfg.command] === "string" && s[cfg.command].trim() ? s[cfg.command].trim() : cfg.fallback;
    return command;
  }
  function ensureServer(serverKey) {
    const st = startState.get(serverKey);
    if (st === "ok") return Promise.resolve(true);
    if (st === "failed") return Promise.resolve(false);
    const inflight = startPromises.get(serverKey);
    if (inflight) return inflight;
    const command = serverConfig(serverKey);
    if (!command) return Promise.resolve(false);
    ensureEventSubscription();
    const p = pageSdk.call("lsp.start", { language: serverKey, command }).then((info) => {
      const ok = (info == null ? void 0 : info.status) === "running";
      startState.set(serverKey, ok ? "ok" : "failed");
      startPromises.delete(serverKey);
      return ok;
    }).catch(() => {
      startState.set(serverKey, "failed");
      startPromises.delete(serverKey);
      return false;
    });
    startPromises.set(serverKey, p);
    return p;
  }
  function ensureProviders() {
    if (providersRegistered) return;
    providersRegistered = true;
    const langs = ["typescript", "javascript", "python"];
    languages.registerCompletionItemProvider(langs, {
      triggerCharacters: [".", "/", '"', "'"],
      provideCompletionItems: async (model, position) => {
        const path = modelPaths.get(model);
        const doc = path ? docs.get(path) : null;
        const serverKey = doc ? serverKeyOf(doc.languageId) : null;
        if (!doc || !serverKey || startState.get(serverKey) !== "ok") return null;
        try {
          const word = model.getWordUntilPosition(position);
          const items = await pageSdk.call(
            "lsp.request",
            {
              language: serverKey,
              method: "textDocument/completion",
              params: {
                textDocument: { uri: pathToUri(doc.path) },
                position: { line: position.lineNumber - 1, character: position.column - 1 },
                context: { triggerKind: 1 }
              }
            }
          );
          const list = Array.isArray(items) ? items : (items == null ? void 0 : items.items) ?? [];
          return {
            suggestions: list.map((it, i) => ({
              label: String(it.label),
              kind: it.kind ?? 13,
              detail: it.detail,
              insertText: it.insertText ?? String(it.label),
              sortText: it.sortText ?? `${i}`.padStart(6, "0"),
              range: { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn }
            }))
          };
        } catch {
          return null;
        }
      }
    });
    languages.registerHoverProvider(langs, {
      provideHover: async (model, position) => {
        const path = modelPaths.get(model);
        const doc = path ? docs.get(path) : null;
        const serverKey = doc ? serverKeyOf(doc.languageId) : null;
        if (!doc || !serverKey || startState.get(serverKey) !== "ok") return null;
        try {
          const hover = await pageSdk.call(
            "lsp.request",
            {
              language: serverKey,
              method: "textDocument/hover",
              params: {
                textDocument: { uri: pathToUri(doc.path) },
                position: { line: position.lineNumber - 1, character: position.column - 1 }
              }
            }
          );
          if (!hover) return null;
          const contents = Array.isArray(hover.contents) ? hover.contents : [hover.contents ?? { value: "" }];
          const text = contents.map((c) => (c == null ? void 0 : c.value) ?? "").filter(Boolean).join("\n\n");
          if (!text) return null;
          return { contents: [{ value: text }] };
        } catch {
          return null;
        }
      }
    });
  }
  const modelPaths = /* @__PURE__ */ new Map();
  function documentOpened(path, languageId, text, model) {
    const serverKey = serverKeyOf(languageId);
    if (!serverKey) return;
    if (docs.has(path)) return;
    modelPaths.set(model, path);
    docs.set(path, { path, languageId, version: 1, model, changeTimer: null, pendingText: null });
    void ensureServer(serverKey).then((ok) => {
      if (!ok) return;
      ensureProviders();
      pageSdk.call("lsp.notify", {
        language: serverKey,
        method: "textDocument/didOpen",
        params: { textDocument: { uri: pathToUri(path), languageId, version: 1, text } }
      }).catch(() => {
      });
    });
  }
  function documentChanged(path, text) {
    const doc = docs.get(path);
    const serverKey = doc ? serverKeyOf(doc.languageId) : null;
    if (!doc || !serverKey || startState.get(serverKey) !== "ok") return;
    doc.pendingText = text;
    if (doc.changeTimer !== null) window.clearTimeout(doc.changeTimer);
    doc.changeTimer = window.setTimeout(() => {
      doc.changeTimer = null;
      const t = doc.pendingText;
      doc.pendingText = null;
      if (t === null || doc.model.isDisposed()) return;
      doc.version += 1;
      pageSdk.call("lsp.notify", {
        language: serverKey,
        method: "textDocument/didChange",
        params: { textDocument: { uri: pathToUri(path), version: doc.version }, contentChanges: [{ text: t }] }
      }).catch(() => {
      });
    }, 400);
  }
  function documentClosed(path) {
    const doc = docs.get(path);
    if (!doc) return;
    if (doc.changeTimer !== null) window.clearTimeout(doc.changeTimer);
    if (!doc.model.isDisposed()) editor.setModelMarkers(doc.model, "lsp", []);
    modelPaths.delete(doc.model);
    docs.delete(path);
    const serverKey = serverKeyOf(doc.languageId);
    if (serverKey && startState.get(serverKey) === "ok") {
      pageSdk.call("lsp.notify", {
        language: serverKey,
        method: "textDocument/didClose",
        params: { textDocument: { uri: pathToUri(path) } }
      }).catch(() => {
      });
    }
  }
  const KIND_EXTS = {
    pdf: /* @__PURE__ */ new Set([".pdf"]),
    pptx: /* @__PURE__ */ new Set([".pptx", ".pptm", ".ppsx", ".potx"]),
    docx: /* @__PURE__ */ new Set([".docx", ".docm", ".dotx"]),
    xlsx: /* @__PURE__ */ new Set([".xlsx", ".xlsm", ".xltx"]),
    ods: /* @__PURE__ */ new Set([".ods"]),
    csv: /* @__PURE__ */ new Set([".csv"]),
    tsv: /* @__PURE__ */ new Set([".tsv"]),
    legacy: /* @__PURE__ */ new Set([".doc", ".xls", ".ppt", ".odt", ".odp", ".rtf", ".pages", ".key", ".numbers"])
  };
  function officeKindOf(p) {
    const i = p.lastIndexOf(".");
    if (i < 0) return null;
    const ext = p.slice(i).toLowerCase();
    for (const kind of Object.keys(KIND_EXTS)) {
      if (KIND_EXTS[kind].has(ext)) return kind;
    }
    return null;
  }
  function previewerOf(kind) {
    switch (kind) {
      case "pdf":
        return "pdf";
      case "pptx":
        return "pptx";
      case "docx":
        return "docx";
      case "xlsx":
      case "ods":
      case "csv":
      case "tsv":
        return "sheet";
      default:
        return null;
    }
  }
  function formatSize(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }
  const IFRAME_CSS = `
html, body { margin: 0; padding: 0; height: 100%; }
body {
  font-family: system-ui, "Segoe UI", "Microsoft YaHei", sans-serif;
  background: #f2f2f2; color: #222;
}
body.dark { background: #1f1f1f; color: #ddd; }
#gitter-preview-root { position: absolute; inset: 0; overflow: auto; overflow-anchor: none; }
/* overflow-anchor:none：pdf 缩放重渲染会整片替换画布，Chromium 滚动锚定在
   DOM 替换时自行调整 scrollTop，与中心锚定的滚动补偿相互打架（实测
   st 800→1182 的补偿被锚定改写成 382）。我们是程序化滚动的确定性场景，禁用。 */
/* 内容层缩放载体：transform: scale（宿主经消息设置）。
   width:max-content 让滚动包围盒恰好等于内容（放大的空边不出现），
   margin:0 auto 在窄于视口时居中、溢出时自动归零（不会左侧不可达）。 */
.gpv-content { width: max-content; min-width: 100%; margin: 0 auto; transform-origin: 0 0; }
.gpv-empty { padding: 48px 24px; text-align: center; font-size: 12.5px; opacity: .6; }

/* pdf：灰背板 + 居中页卡 */
.gpv-pdf { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 24px 0; }
.gpv-pdf-page { background: #fff; box-shadow: 0 2px 12px rgba(0, 0, 0, .28); }

/* docx：docx-preview 自带 .docx-wrapper 灰底，覆写为透明贴合主题背板 */
.gpv-docx .docx-wrapper { background: transparent; padding: 24px 0; }

/* 表格：工作表 tab 条（sticky，位于滚动容器直下、缩放载体之外——横纵双向钉扎）+ 白底表格 */
.gpv-sheet-tabs {
  position: sticky; top: 0; left: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 2px;
  padding: 5px 8px; background: #e8e8e8; border-bottom: 1px solid #d0d0d0;
}
body.dark .gpv-sheet-tabs { background: #262626; border-bottom-color: #3a3a3a; }
.gpv-sheet-tabs button {
  appearance: none; border: 1px solid transparent; border-radius: 4px; padding: 2px 10px;
  font: inherit; font-size: 12px; background: transparent; color: inherit; cursor: pointer;
}
.gpv-sheet-tabs button:hover { background: rgba(127, 127, 127, .15); }
.gpv-sheet-tabs button.active { background: #fff; border-color: #c9c9c9; font-weight: 600; }
body.dark .gpv-sheet-tabs button.active { background: #3a3a3a; border-color: #4a4a4a; }
.gpv-sheet-table { padding: 0 12px 24px; }
.gpv-sheet-table table { border-collapse: collapse; background: #fff; color: #1a1a1a; font-size: 12.5px; table-layout: fixed; }
.gpv-sheet-table td {
  border: 1px solid #ddd; padding: 3px 8px; vertical-align: top;
  overflow: hidden; white-space: pre-wrap; word-break: break-word; max-width: 400px;
}
.gpv-sheet-table td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.gpv-sheet-table td.hint { text-align: center; color: #888; font-size: 11.5px; background: #f6f6f6; }

/* pptx：pptx-preview 自绘幻灯片，仅给外边距 */
.gpv-pptx { padding: 16px 0 24px; }
`;
  const PREVIEW_MSG_SRC = "gitter-office-preview";
  function buildSrcdoc() {
    var _a2;
    const lib2 = (_a2 = window.GITTER_LIBS) == null ? void 0 : _a2.officeview;
    if (typeof (lib2 == null ? void 0 : lib2.runtimeJs) !== "string" || !lib2.runtimeJs) {
      throw new Error("GITTER_LIBS.officeview 未注册——officeview 库（gitui.page.office）未装载");
    }
    const scripts = typeof lib2.srcdocScripts === "function" ? lib2.srcdocScripts() : [lib2.runtimeJs];
    const body = scripts.filter((s) => typeof s === "string" && s.length > 0).map((s) => `<script>${s.replace(/<\/script/gi, "<\\/script>")}<\/script>`).join("");
    return `<!doctype html><html><head><meta charset="utf-8"><style>${IFRAME_CSS}</style></head><body><div id="gitter-preview-root"></div>${body}</body></html>`;
  }
  const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4];
  function zoomStep(z, dir) {
    if (dir > 0) return ZOOM_STEPS.find((s) => s > z + 1e-9) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
    return [...ZOOM_STEPS].reverse().find((s) => s < z - 1e-9) ?? ZOOM_STEPS[0];
  }
  function PreviewFrame(props) {
    const iframeRef = React$1.useRef(null);
    const sentRef = React$1.useRef(false);
    const settledRef = React$1.useRef(false);
    const [srcdoc] = React$1.useState(buildSrcdoc);
    const onDoneRef = React$1.useRef(props.onDone);
    onDoneRef.current = props.onDone;
    const onErrorRef = React$1.useRef(props.onError);
    onErrorRef.current = props.onError;
    const rendererRef = React$1.useRef(props.renderer);
    rendererRef.current = props.renderer;
    const nameRef = React$1.useRef(props.name);
    nameRef.current = props.name;
    const payloadRef = React$1.useRef(props.payload);
    payloadRef.current = props.payload;
    const darkRef = React$1.useRef(props.dark);
    darkRef.current = props.dark;
    const zoomRef = React$1.useRef(props.zoom);
    zoomRef.current = props.zoom;
    const onZoomDeltaRef = React$1.useRef(props.onZoomDelta);
    onZoomDeltaRef.current = props.onZoomDelta;
    const timeoutMsgRef = React$1.useRef(props.timeoutMessage);
    timeoutMsgRef.current = props.timeoutMessage;
    React$1.useEffect(() => {
      var _a2;
      if (sentRef.current && ((_a2 = iframeRef.current) == null ? void 0 : _a2.contentWindow)) {
        iframeRef.current.contentWindow.postMessage(
          { source: PREVIEW_MSG_SRC, type: "zoom", zoom: props.zoom },
          "*"
        );
      }
    }, [props.zoom]);
    React$1.useEffect(() => {
      sentRef.current = false;
      settledRef.current = false;
      const timer = window.setTimeout(() => {
        if (!settledRef.current) {
          settledRef.current = true;
          onErrorRef.current(timeoutMsgRef.current);
        }
      }, 3e4);
      const handler = (ev) => {
        var _a2, _b2;
        if (ev.source !== ((_a2 = iframeRef.current) == null ? void 0 : _a2.contentWindow)) return;
        const msg = ev.data;
        if (!msg || msg.source !== PREVIEW_MSG_SRC) return;
        if (msg.type === "ready" && !sentRef.current) {
          sentRef.current = true;
          const win = (_b2 = iframeRef.current) == null ? void 0 : _b2.contentWindow;
          if (win) {
            win.postMessage({
              source: PREVIEW_MSG_SRC,
              type: "render",
              id: 1,
              renderer: rendererRef.current,
              name: nameRef.current,
              dark: darkRef.current,
              base64: payloadRef.current.base64,
              text: payloadRef.current.text
            }, "*");
            if (zoomRef.current !== 1) {
              win.postMessage({ source: PREVIEW_MSG_SRC, type: "zoom", zoom: zoomRef.current }, "*");
            }
          }
          return;
        }
        if (msg.type === "zoom-request") {
          onZoomDeltaRef.current(msg.dir != null && msg.dir < 0 ? -1 : 1);
          return;
        }
        if (settledRef.current) return;
        if (msg.type === "done") {
          settledRef.current = true;
          window.clearTimeout(timer);
          onDoneRef.current(msg.info ?? {});
        } else if (msg.type === "error") {
          settledRef.current = true;
          window.clearTimeout(timer);
          onErrorRef.current(String(msg.message ?? "preview error"));
        }
      };
      window.addEventListener("message", handler);
      return () => {
        window.removeEventListener("message", handler);
        window.clearTimeout(timer);
      };
    }, [props.path]);
    return /* @__PURE__ */ jsxRuntime.jsx(
      "iframe",
      {
        ref: iframeRef,
        className: "office-preview-frame",
        sandbox: "allow-scripts",
        title: props.name,
        srcDoc: srcdoc
      }
    );
  }
  async function loadBinaryPayload(path) {
    const st = await pageSdk.call("file.stat", { path });
    const r = await pageSdk.call("file.readBinary", { path });
    if (!r) throw new Error(pageSdk.t("Files_Missing"));
    if (r.truncated) throw new Error(pageSdk.t("Office_TooLarge"));
    return { payload: { base64: r.base64 }, size: (st == null ? void 0 : st.size) ?? null };
  }
  function OfficeDocViewer(props) {
    const t = pageSdk.t;
    const repo = pageSdk.repo();
    const dark = (document.documentElement.getAttribute("data-base") ?? "dark") !== "light";
    const [phase, setPhase] = React$1.useState("loading");
    const [payload, setPayload] = React$1.useState(null);
    const [size, setSize] = React$1.useState(null);
    const [pageCount, setPageCount] = React$1.useState(null);
    const [zoom, setZoom] = React$1.useState(1);
    const [nonce, setNonce] = React$1.useState(0);
    const [errorMsg, setError] = React$1.useState(null);
    const kind = officeKindOf(props.path);
    const renderer = kind ? previewerOf(kind) : null;
    const name = props.path.split("/").pop() ?? props.path;
    React$1.useEffect(() => {
      let stale = false;
      setPhase("loading");
      setPayload(null);
      setPageCount(null);
      setSize(null);
      setZoom(1);
      (async () => {
        try {
          const { payload: p, size: s } = await loadBinaryPayload(props.path);
          if (stale) return;
          setPayload(p);
          setSize(s);
          setPhase("rendering");
        } catch (e) {
          if (stale) return;
          setPhase("error");
          setError(e.message);
        }
      })();
      return () => {
        stale = true;
      };
    }, [props.path, nonce]);
    const onDone = React$1.useCallback((info) => {
      setPageCount(info.pages ?? null);
      setPhase("ready");
    }, []);
    const onError = React$1.useCallback((message) => {
      setError(message);
      setPhase("error");
    }, []);
    const retry = React$1.useCallback(() => {
      setError(null);
      setPhase("rendering");
      setNonce((n) => n + 1);
    }, []);
    const openExternal = React$1.useCallback(() => {
      if (repo) void pageSdk.call("shell.openPath", { path: absPathOf(repo.workDir, props.path), editor: true });
    }, [repo, props.path]);
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "office-canvas", style: { position: "absolute", inset: 0 }, children: [
      phase === "error" ? /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "office-welcome", children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "edwm", children: "!" }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "list", style: { alignItems: "flex-start" }, children: [
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "h", children: t("Office_PreviewFailed") }),
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "wrow", style: { height: "auto", whiteSpace: "normal" }, children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "nm2", children: errorMsg }) }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 8, marginTop: 10 }, children: [
            /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn primary", onClick: retry, children: t("Office_Retry") }),
            /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: openExternal, children: t("Office_ExternalOpen") })
          ] })
        ] })
      ] }) : phase === "legacy" || !payload || !renderer ? /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "office-welcome", children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "edwm", children: name }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "list", style: { alignItems: "flex-start" }, children: [
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "h", children: name }),
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "wrow", style: { height: "auto", whiteSpace: "normal" }, children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "nm2", children: t("Office_PreviewUnavailable") }) }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn primary", style: { marginTop: 10 }, onClick: openExternal, children: t("Office_ExternalOpen") })
        ] })
      ] }) : /* @__PURE__ */ jsxRuntime.jsx(
        PreviewFrame,
        {
          path: props.path,
          renderer,
          name,
          payload,
          dark,
          zoom,
          onZoomDelta: (dir) => setZoom((z) => zoomStep(z, dir)),
          timeoutMessage: t("Office_PreviewTimeout"),
          onDone,
          onError
        },
        `${props.path}:${nonce}`
      ),
      (phase === "loading" || phase === "rendering") && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "office-loading", children: t("Office_Loading") }),
      phase === "ready" && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "ed-office-hud", children: [
        pageCount != null && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "it", children: t("Office_PageCount", pageCount) }),
        size != null && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "it", children: formatSize(size) }),
        /* @__PURE__ */ jsxRuntime.jsx(
          "button",
          {
            className: "files-ibtn",
            title: t("Office_ZoomOut"),
            disabled: zoom <= ZOOM_STEPS[0],
            onClick: () => setZoom((z) => zoomStep(z, -1)),
            children: /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "12", height: "12", viewBox: "0 0 12 12", stroke: "currentColor", strokeWidth: "1.4", fill: "none", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M1.5 6h9" }) })
          }
        ),
        /* @__PURE__ */ jsxRuntime.jsxs("button", { className: "office-zoom-pct", title: t("Office_ZoomReset"), onClick: () => setZoom(1), children: [
          Math.round(zoom * 100),
          "%"
        ] }),
        /* @__PURE__ */ jsxRuntime.jsx(
          "button",
          {
            className: "files-ibtn",
            title: t("Office_ZoomIn"),
            disabled: zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1],
            onClick: () => setZoom((z) => zoomStep(z, 1)),
            children: /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "12", height: "12", viewBox: "0 0 12 12", stroke: "currentColor", strokeWidth: "1.4", fill: "none", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M6 1.5v9M1.5 6h9" }) })
          }
        ),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "files-ibtn", title: t("Office_ExternalOpen"), onClick: openExternal, children: /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "13", height: "13", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M6.5 3.5H4A1.5 1.5 0 0 0 2.5 5v7A1.5 1.5 0 0 0 4 13.5h7a1.5 1.5 0 0 0 1.5-1.5V9.5M9 2.5h4.5V7M13 3 7.5 8.5", stroke: "currentColor", strokeWidth: "1.2", strokeLinecap: "round", strokeLinejoin: "round" }) }) })
      ] })
    ] });
  }
  const IMAGE_EXTS = [
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
    ".bmp",
    ".avif",
    ".ico"
  ];
  function imageMimeOf(path) {
    const i = path.lastIndexOf(".");
    const ext = i >= 0 ? path.slice(i + 1).toLowerCase() : "";
    if (ext === "jpg") return "jpeg";
    if (ext === "svg") return "svg+xml";
    if (ext === "ico") return "x-icon";
    return ext || "octet-stream";
  }
  function fitScale(nat, stage) {
    return Math.min(stage.w / nat.w, stage.h / nat.h);
  }
  function ImageFileViewer(props) {
    const t = pageSdk.t;
    const repo = pageSdk.repo();
    const stageRef = React$1.useRef(null);
    const [dataUrl, setDataUrl] = React$1.useState(null);
    const [size, setSize] = React$1.useState(null);
    const [natural, setNatural] = React$1.useState(null);
    const [stage, setStage] = React$1.useState(null);
    const [zoom, setZoom] = React$1.useState(1);
    const [nonce, setNonce] = React$1.useState(0);
    const [errorMsg, setError] = React$1.useState(null);
    const phase = errorMsg ? "error" : dataUrl ? "ready" : "loading";
    const name = props.path.split("/").pop() ?? props.path;
    React$1.useEffect(() => {
      let stale = false;
      setDataUrl(null);
      setNatural(null);
      setSize(null);
      setZoom(1);
      (async () => {
        try {
          const [st, r] = await Promise.all([
            pageSdk.call("file.stat", { path: props.path }),
            pageSdk.call(
              "file.readBinary",
              { path: props.path }
            )
          ]);
          if (stale) return;
          if (!r) throw new Error(t("Files_Missing"));
          if (r.truncated) throw new Error(t("Files_ImgTooLarge"));
          setSize((st == null ? void 0 : st.size) ?? r.size);
          setDataUrl(`data:image/${imageMimeOf(props.path)};base64,${r.base64}`);
        } catch (e) {
          if (stale) return;
          setError(e.message);
        }
      })();
      return () => {
        stale = true;
      };
    }, [props.path, nonce]);
    React$1.useEffect(() => {
      const el = stageRef.current;
      if (!el) return;
      const ro = new ResizeObserver(() => {
        setStage((prev) => {
          const next = { w: el.clientWidth, h: el.clientHeight };
          return prev && prev.w === next.w && prev.h === next.h ? prev : next;
        });
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, [dataUrl]);
    const onImgLoad = React$1.useCallback((e) => {
      const img = e.currentTarget;
      setNatural((prev) => {
        const next = { w: img.naturalWidth || 1, h: img.naturalHeight || 1 };
        return prev && prev.w === next.w && prev.h === next.h ? prev : next;
      });
    }, []);
    const imgRef = React$1.useCallback((el) => {
      if (el && el.complete && el.naturalWidth > 0) {
        setNatural((prev) => {
          const next = { w: el.naturalWidth, h: el.naturalHeight };
          return prev && prev.w === next.w && prev.h === next.h ? prev : next;
        });
      }
    }, []);
    const openExternal = React$1.useCallback(() => {
      if (repo) void pageSdk.call("shell.openPath", { path: absPathOf(repo.workDir, props.path) });
    }, [repo, props.path]);
    const disp = natural && stage ? (() => {
      const scale = fitScale(natural, stage) * zoom;
      return { w: Math.max(1, Math.round(natural.w * scale)), h: Math.max(1, Math.round(natural.h * scale)) };
    })() : null;
    const pixelated = zoom >= 3 ? "pixelated" : void 0;
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "office-canvas", style: { position: "absolute", inset: 0 }, children: [
      phase === "error" ? /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "office-welcome", children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "edwm", children: "!" }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "list", style: { alignItems: "flex-start" }, children: [
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "h", children: t("Files_ImgFailed") }),
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "wrow", style: { height: "auto", whiteSpace: "normal" }, children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "nm2", children: errorMsg }) }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", gap: 8, marginTop: 10 }, children: [
            /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn primary", onClick: () => setError(null), children: t("Files_Retry") }),
            /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: openExternal, children: t("Files_ExternalOpen") })
          ] })
        ] })
      ] }) : dataUrl ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "imgview-stage imgview-checker", ref: stageRef, children: disp ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "imgview-frame", style: { width: disp.w, height: disp.h }, children: /* @__PURE__ */ jsxRuntime.jsx("img", { ref: imgRef, src: dataUrl, alt: name, onLoad: onImgLoad, style: { imageRendering: pixelated } }) }) : /* @__PURE__ */ jsxRuntime.jsx("img", { className: "imgview-fit", ref: imgRef, src: dataUrl, alt: name, onLoad: onImgLoad }) }) : null,
      phase === "loading" && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "office-loading", children: "Loading…" }),
      phase === "ready" && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "ed-office-hud", children: [
        size != null && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "it", children: formatSize(size) }),
        /* @__PURE__ */ jsxRuntime.jsx(
          "button",
          {
            className: "files-ibtn",
            title: t("Files_ZoomOut"),
            disabled: zoom <= ZOOM_STEPS[0],
            onClick: () => setZoom((z) => zoomStep(z, -1)),
            children: /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "12", height: "12", viewBox: "0 0 12 12", stroke: "currentColor", strokeWidth: "1.4", fill: "none", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M1.5 6h9" }) })
          }
        ),
        /* @__PURE__ */ jsxRuntime.jsxs("button", { className: "office-zoom-pct", title: t("Files_ZoomReset"), onClick: () => setZoom(1), children: [
          Math.round(zoom * 100),
          "%"
        ] }),
        /* @__PURE__ */ jsxRuntime.jsx(
          "button",
          {
            className: "files-ibtn",
            title: t("Files_ZoomIn"),
            disabled: zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1],
            onClick: () => setZoom((z) => zoomStep(z, 1)),
            children: /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "12", height: "12", viewBox: "0 0 12 12", stroke: "currentColor", strokeWidth: "1.4", fill: "none", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M6 1.5v9M1.5 6h9" }) })
          }
        ),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "files-ibtn", title: t("Files_ExternalOpen"), onClick: openExternal, children: /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "13", height: "13", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M6.5 3.5H4A1.5 1.5 0 0 0 2.5 5v7A1.5 1.5 0 0 0 4 13.5h7a1.5 1.5 0 0 0 1.5-1.5V9.5M9 2.5h4.5V7M13 3 7.5 8.5", stroke: "currentColor", strokeWidth: "1.2", strokeLinecap: "round", strokeLinejoin: "round" }) }) })
      ] })
    ] });
  }
  function api() {
    if (!window.gitter) {
      return {
        invoke: async () => ({ ok: false, error: { message: "不在 Electron 宿主内（桥不可用）" } }),
        onEvent: () => () => {
        },
        winAction: () => {
        },
        isMaximized: async () => false
      };
    }
    return window.gitter;
  }
  class BridgeCallError extends Error {
    constructor(message, detail) {
      super(message);
      this.detail = detail;
    }
  }
  async function call(method, params) {
    const res = await api().invoke(method, params);
    if (!res.ok) throw new BridgeCallError(res.error.message, res.error.detail);
    return res.data;
  }
  const MD_EXTS = [".md", ".markdown"];
  const HTML_EXTS = [".html", ".htm"];
  function isMdPath(p) {
    const i = p.lastIndexOf(".");
    return i >= 0 && MD_EXTS.includes(p.slice(i).toLowerCase());
  }
  function isHtmlPath(p) {
    const i = p.lastIndexOf(".");
    return i >= 0 && HTML_EXTS.includes(p.slice(i).toLowerCase());
  }
  function isExternalPreviewPath(p) {
    return isMdPath(p) || isHtmlPath(p);
  }
  function isProviderResult(r) {
    return !!r && typeof r.kind === "string" && typeof r.content === "string";
  }
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function runsToHtml(line, runs, colors) {
    let out = "";
    let pos = 0;
    for (const r of runs) {
      if (r.start > pos) out += escapeHtml(line.slice(pos, r.start));
      const seg = escapeHtml(line.slice(r.start, r.end));
      const color = r.color ?? colors[r.style];
      out += color ? `<span style="color:${color}">${seg}</span>` : seg;
      pos = r.end;
    }
    if (pos < line.length) out += escapeHtml(line.slice(pos));
    return out;
  }
  async function injectCodeHighlight(html) {
    if (!html.includes("<code")) return html;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const codes = [...doc.querySelectorAll("pre > code")];
    if (codes.length === 0) return html;
    const results = await Promise.all(codes.map(async (el) => {
      var _a2;
      const lang = ((_a2 = /language-([\w+#.-]+)/.exec(el.className)) == null ? void 0 : _a2[1]) ?? null;
      if (!lang) return null;
      const code = el.textContent ?? "";
      if (!code.trim()) return null;
      try {
        const r = await call(
          "highlight.snippet",
          { code, lang }
        );
        if (!r || r.lines.length === 0) return null;
        const htmlLines = code.split("\n").map((line, i) => runsToHtml(line, r.lines[i] ?? [], r.syntaxColors));
        return { el, html: htmlLines.join("\n") };
      } catch {
        return null;
      }
    }));
    let changed = false;
    for (const res of results) {
      if (!res) continue;
      res.el.innerHTML = res.html;
      changed = true;
    }
    return changed ? doc.body.innerHTML : html;
  }
  function mdSrcdoc(html, dark) {
    const c = dark ? { bg: "#14161B", fg: "#D4D4D4", fg2: "#A8B0BC", border: "#FFFFFF21", thumb: "#FFFFFF40", thumbHover: "#FFFFFF59", codeBg: "#FFFFFF12", link: "#6BABF5" } : { bg: "#FFFFFF", fg: "#1B1B1B", fg2: "#5C5C5C", border: "#E5E5E5", thumb: "#C9C9CE", thumbHover: "#AFAFB5", codeBg: "#F2F2F3", link: "#0B6BCB" };
    return `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { background: ${c.bg}; }
body { margin: 0; padding: 28px 34px 48px; font: 14px/1.75 "Segoe UI","Microsoft YaHei",system-ui,sans-serif; color: ${c.fg}; }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: ${c.thumb}; border-radius: 4px; border: 2px solid transparent; background-clip: content-box; }
::-webkit-scrollbar-thumb:hover { background: ${c.thumbHover}; background-clip: content-box; }
h1, h2, h3, h4, h5, h6 { line-height: 1.35; margin: 1.4em 0 .55em; }
h1, h2 { border-bottom: 1px solid ${c.border}; padding-bottom: .3em; }
h1:first-child, h2:first-child, h1 + h2 { margin-top: .4em; }
p { margin: .65em 0; }
code { background: ${c.codeBg}; padding: .15em .38em; border-radius: 4px; font-family: Consolas,"Cascadia Mono",monospace; font-size: 92%; }
pre { background: ${c.codeBg}; padding: 12px 14px; border-radius: 8px; overflow: auto; line-height: 1.6; }
pre code { background: transparent; padding: 0; }
blockquote { margin: .8em 0; padding: 0 1em; color: ${c.fg2}; border-left: 3px solid ${c.border}; }
table { border-collapse: collapse; margin: .8em 0; }
th, td { border: 1px solid ${c.border}; padding: 5px 12px; }
th { background: ${c.codeBg}; }
img { max-width: 100%; }
a { color: ${c.link}; text-decoration: none; }
a:hover { text-decoration: underline; }
hr { border: 0; border-top: 1px solid ${c.border}; margin: 1.6em 0; }
ul, ol { padding-left: 1.6em; }
li { margin: .25em 0; }
</style></head><body>${html}</body></html>`;
  }
  function ExternalFilePreview(props) {
    const theme = useAppState().theme;
    const dark = props.dark ?? ((theme == null ? void 0 : theme.base) ?? "dark") !== "light";
    const htmlRaw = isHtmlPath(props.path);
    const [phase, setPhase] = React$1.useState({ kind: "loading" });
    React$1.useEffect(() => {
      let stale = false;
      setPhase({ kind: "loading" });
      call("file.preview", { path: props.path }).then(async (r) => {
        if (stale) return;
        if (isProviderResult(r)) {
          const content = r.kind === "html" && !isHtmlPath(props.path) ? await injectCodeHighlight(r.content).catch(() => r.content) : r.content;
          if (!stale) setPhase({ kind: r.kind, content });
        } else setPhase({ kind: "fallback" });
      }).catch(() => {
        if (!stale) setPhase({ kind: "fallback" });
      });
      return () => {
        stale = true;
      };
    }, [props.path, dark]);
    const name = props.path.split("/").pop() ?? props.path;
    const frameRef = React$1.useRef(null);
    const preRef = React$1.useRef(null);
    const scrollTimerRef = React$1.useRef(null);
    const propsRef = React$1.useRef({ initialScrollTop: props.initialScrollTop, onScrollTop: props.onScrollTop });
    propsRef.current = { initialScrollTop: props.initialScrollTop, onScrollTop: props.onScrollTop };
    const reportScroll = React$1.useCallback((top) => {
      if (scrollTimerRef.current !== null) window.clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = window.setTimeout(() => {
        var _a2, _b2;
        scrollTimerRef.current = null;
        (_b2 = (_a2 = propsRef.current).onScrollTop) == null ? void 0 : _b2.call(_a2, top);
      }, 400);
    }, []);
    React$1.useEffect(() => {
      if (phase.kind !== "html") return;
      const f = frameRef.current;
      if (!f) return;
      let cleanedUp = false;
      const applyInitial = () => {
        if (cleanedUp) return;
        const w = f.contentWindow;
        if (!w) return;
        const t = propsRef.current.initialScrollTop;
        if (typeof t === "number" && t > 0) {
          try {
            if (htmlRaw) {
              w.postMessage({ type: "preview-restore", scrollY: t }, "*");
            } else {
              w.scrollTo(0, t);
            }
          } catch {
          }
        }
      };
      f.addEventListener("load", applyInitial);
      return () => {
        var _a2, _b2;
        cleanedUp = true;
        f.removeEventListener("load", applyInitial);
        const pending = scrollTimerRef.current;
        if (pending !== null) {
          window.clearTimeout(pending);
          const w = f.contentWindow;
          if (w) {
            try {
              if (htmlRaw) {
                w.postMessage({ type: "preview-flush" }, "*");
              } else {
                const t = w.scrollY ?? 0;
                (_b2 = (_a2 = propsRef.current).onScrollTop) == null ? void 0 : _b2.call(_a2, t);
              }
            } catch {
            }
          }
        }
        scrollTimerRef.current = null;
      };
    }, [phase.kind, htmlRaw, reportScroll]);
    const [htmlWithTracker, setHtmlWithTracker] = React$1.useState(null);
    const phaseContent = phase.kind === "html" || phase.kind === "text" ? phase.content : "";
    React$1.useEffect(() => {
      if (phase.kind !== "html" || !htmlRaw) {
        setHtmlWithTracker(null);
        return;
      }
      const script = `<script>(function(){var t=null;function flush(){parent.postMessage({type:'preview-scroll',scrollY:window.scrollY},'*')}window.addEventListener('scroll',function(){if(t)clearTimeout(t);t=setTimeout(function(){t=null;flush()},400)},{passive:true});window.addEventListener('message',function(e){var d=e.data;if(d&&d.type==='preview-restore'&&typeof d.scrollY==='number'){window.scrollTo(0,d.scrollY)}else if(d&&d.type==='preview-flush'){flush()}});parent.postMessage({type:'preview-ready'},'*')})();<\/script>`;
      setHtmlWithTracker(phaseContent + script);
    }, [phase.kind, htmlRaw, phaseContent]);
    React$1.useEffect(() => {
      if (!htmlRaw) return;
      const onMsg = (e) => {
        const f = frameRef.current;
        if (!f || e.source !== f.contentWindow) return;
        const d = e.data;
        if ((d == null ? void 0 : d.type) === "preview-scroll" && typeof d.scrollY === "number") {
          reportScroll(d.scrollY);
        }
      };
      window.addEventListener("message", onMsg);
      return () => window.removeEventListener("message", onMsg);
    }, [htmlRaw, reportScroll]);
    const onPreScroll = React$1.useCallback(() => {
      const el = preRef.current;
      if (el) reportScroll(el.scrollTop);
    }, [reportScroll]);
    React$1.useEffect(() => {
      if (phase.kind !== "text") return;
      const el = preRef.current;
      if (!el) return;
      const t = propsRef.current.initialScrollTop;
      if (typeof t === "number" && t > 0) {
        try {
          el.scrollTop = t;
        } catch {
        }
      }
    }, [phase.kind]);
    React$1.useEffect(() => () => {
      var _a2, _b2;
      const pending = scrollTimerRef.current;
      if (pending !== null) {
        window.clearTimeout(pending);
        scrollTimerRef.current = null;
      }
      const el = preRef.current;
      if (el) {
        try {
          (_b2 = (_a2 = propsRef.current).onScrollTop) == null ? void 0 : _b2.call(_a2, el.scrollTop);
        } catch {
        }
      }
    }, []);
    return /* @__PURE__ */ jsxRuntime.jsx("div", { style: { position: "absolute", inset: 0 }, children: phase.kind === "loading" ? null : phase.kind === "html" ? /* @__PURE__ */ jsxRuntime.jsx(
      "iframe",
      {
        ref: frameRef,
        className: "extpreview-frame",
        sandbox: htmlRaw ? "allow-scripts allow-forms allow-modals" : "allow-same-origin",
        title: name,
        srcDoc: htmlRaw ? htmlWithTracker ?? phase.content : mdSrcdoc(phase.content, dark),
        onLoad: () => {
          const f = frameRef.current;
          const w = f == null ? void 0 : f.contentWindow;
          if (w && !htmlRaw) {
            w.addEventListener("scroll", () => {
              reportScroll(w.scrollY ?? 0);
            });
          }
        }
      }
    ) : phase.kind === "text" ? /* @__PURE__ */ jsxRuntime.jsx("pre", { ref: preRef, className: "extpreview-text", onScroll: onPreScroll, children: phase.content }) : /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "office-welcome", children: [
      /* @__PURE__ */ jsxRuntime.jsx("div", { className: "edwm", children: name }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "list", style: { alignItems: "flex-start" }, children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "h", children: props.fallbackTitle ?? "外部预览不可用" }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "wrow", style: { height: "auto", whiteSpace: "normal" }, children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "nm2", children: props.fallbackBody ?? "未安装提供该格式预览的插件（设置 → 扩展 → 允许代码插件）" }) }),
        props.onEditText && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn primary", style: { marginTop: 10 }, onClick: props.onEditText, children: props.editLabel ?? "编辑源文件" })
      ] })
    ] }) });
  }
  const viewers = [];
  function registerFileViewer(kinds, render) {
    viewers.push({
      matches: (p) => {
        const k = officeKindOf(p);
        return k !== null && kinds.includes(k);
      },
      render
    });
  }
  function registerFileExtViewer(exts, render) {
    const set = new Set(exts);
    viewers.push({
      matches: (p) => {
        const i = p.lastIndexOf(".");
        return i >= 0 && set.has(p.slice(i).toLowerCase());
      },
      render
    });
  }
  function viewerForPath(path) {
    for (const v of viewers) {
      if (v.matches(path)) return v.render;
    }
    return null;
  }
  registerFileViewer(["pdf", "pptx", "docx", "xlsx", "ods"], (p) => /* @__PURE__ */ jsxRuntime.jsx(OfficeDocViewer, { ...p }));
  registerFileExtViewer(IMAGE_EXTS, (p) => /* @__PURE__ */ jsxRuntime.jsx(ImageFileViewer, { ...p }));
  registerFileExtViewer(MD_EXTS, (p) => /* @__PURE__ */ jsxRuntime.jsx(ExternalFilePreview, { ...p, onEditText: p.onEditText ? () => p.onEditText(p.path) : void 0 }));
  registerFileExtViewer(HTML_EXTS, (p) => /* @__PURE__ */ jsxRuntime.jsx(ExternalFilePreview, { ...p, onEditText: p.onEditText ? () => p.onEditText(p.path) : void 0 }));
  const STATUS_CLS = { M: "gs-M", A: "gs-A", D: "gs-D", R: "gs-R", U: "gs-U", "?": "gs-Q" };
  const STATUS_LETTER = { M: "M", A: "A", D: "D", R: "R", U: "U", "?": "?" };
  function fsAffected(root, isDir, p) {
    return p === root || isDir && p.startsWith(root + "/");
  }
  function fsRemap(p, oldPath, newPath, isDir) {
    return isDir ? newPath + p.slice(oldPath.length) : newPath;
  }
  function uriFor(path) {
    return Uri.file(path.replace(/\\/g, "/")).toString();
  }
  const uriToModelId = /* @__PURE__ */ new Map();
  const EditorPane = React$1.forwardRef(function EditorPane2(props, ref) {
    var _a2, _b2, _c2;
    const [editors, setEditors] = React$1.useState(/* @__PURE__ */ new Map());
    const [saving, setSaving] = React$1.useState(false);
    const [confirmClose, setConfirmClose] = React$1.useState(null);
    const [conflict, setConflict] = React$1.useState(null);
    const [position, setPosition] = React$1.useState({ line: 1, col: 1 });
    const [markers, setMarkers] = React$1.useState({ errors: 0, warnings: 0 });
    const [savedAt, setSavedAt] = React$1.useState(null);
    const { showMenu, menuElement } = useContextMenu();
    const saveTimers = React$1.useRef(/* @__PURE__ */ new Map());
    const savedTimer = React$1.useRef(null);
    const models = React$1.useRef(/* @__PURE__ */ new Map());
    const t = pageSdk.t;
    const autoSave = ((_a2 = useAppState().settings) == null ? void 0 : _a2.editorAutoSave) !== false;
    const autoSaveRef = React$1.useRef(autoSave);
    autoSaveRef.current = autoSave;
    const [textMode, setTextMode] = React$1.useState(/* @__PURE__ */ new Set());
    const textModeRef = React$1.useRef(textMode);
    textModeRef.current = textMode;
    const [confirmReopen, setConfirmReopen] = React$1.useState(null);
    const [confirmDiscard, setConfirmDiscard] = React$1.useState(null);
    const [headDiff, setHeadDiff] = React$1.useState(null);
    const initialModesAppliedRef = React$1.useRef(/* @__PURE__ */ new Set());
    const [problemsOpen, setProblemsOpen] = React$1.useState(false);
    const [markerTick, setMarkerTick] = React$1.useState(0);
    React$1.useEffect(() => {
      const d = onAnyMarkers(() => setMarkerTick((v) => v + 1));
      return () => d.dispose();
    }, []);
    const [indentByPath, setIndentByPath] = React$1.useState(/* @__PURE__ */ new Map());
    const [splitPath, setSplitPath] = React$1.useState(null);
    const mainEditorRef = React$1.useRef(null);
    const [localReveal, setLocalReveal] = React$1.useState(null);
    const [diffInfo, setDiffInfo] = React$1.useState(null);
    const editorsRef = React$1.useRef(editors);
    editorsRef.current = editors;
    const externToasted = React$1.useRef(/* @__PURE__ */ new Set());
    const statusOf = React$1.useCallback(
      (path) => path ? props.statusByPath[path] ?? null : null,
      [props.statusByPath]
    );
    const activeStatus = statusOf(props.activeTab);
    const theme = useAppState().theme;
    const editorBg = ((_b2 = theme == null ? void 0 : theme.tokens) == null ? void 0 : _b2.Base) ?? "var(--c-base)";
    const isTextual = React$1.useCallback((p) => !!p && (!viewerForPath(p) || textModeRef.current.has(p)), []);
    const loadFile = React$1.useCallback(async (path, encoding) => {
      if (viewerForPath(path) && !textModeRef.current.has(path) || models.current.has(path)) return;
      setEditors((prev) => {
        const next = new Map(prev);
        next.set(path, {
          path,
          content: "",
          originalContent: "",
          eol: "lf",
          mtime: 0,
          encoding: encoding ?? "utf8",
          bom: false,
          dirty: false,
          loading: true,
          binary: false,
          error: null,
          truncated: false,
          gitBase: null
        });
        return next;
      });
      try {
        const r = await pageSdk.call("file.content", { path, encoding });
        if (!r) {
          setEditors((prev) => {
            const next = new Map(prev);
            const ed = next.get(path);
            if (ed) {
              ed.loading = false;
              ed.error = t("Files_Missing");
            }
            return next;
          });
          return;
        }
        if (r.binary) {
          setEditors((prev) => {
            const next = new Map(prev);
            const ed = next.get(path);
            if (ed) {
              ed.loading = false;
              ed.binary = true;
              ed.content = "";
              ed.originalContent = "";
            }
            return next;
          });
          return;
        }
        const model = createTextModel(path, r.content);
        models.current.set(path, model);
        uriToModelId.set(uriFor(path), model.id);
        const indent2 = detectIndent(r.content);
        model.updateOptions(indent2);
        setIndentByPath((prev) => {
          const next = new Map(prev);
          next.set(path, indent2);
          return next;
        });
        documentOpened(path, languageForPath(path), r.content, model);
        setEditors((prev) => {
          const next = new Map(prev);
          const ed = next.get(path);
          if (ed) {
            ed.loading = false;
            ed.content = r.content;
            ed.originalContent = r.content;
            ed.eol = r.eol;
            ed.encoding = r.encoding;
            ed.bom = r.bom;
            ed.mtime = r.mtime;
            ed.dirty = false;
            ed.truncated = r.truncated;
            ed.error = r.truncated ? t("Editor_ErrorTruncated") : null;
          }
          return next;
        });
        externToasted.current.delete(path);
        void pageSdk.call("file.content", { path, revision: "HEAD" }).then((base) => {
          setEditors((prev) => {
            const next = new Map(prev);
            const ed = next.get(path);
            if (ed) ed.gitBase = base ? base.content : "";
            return next;
          });
        }).catch(() => {
          setEditors((prev) => {
            const next = new Map(prev);
            const ed = next.get(path);
            if (ed) ed.gitBase = "";
            return next;
          });
        });
      } catch (e) {
        setEditors((prev) => {
          const next = new Map(prev);
          const ed = next.get(path);
          if (ed) {
            ed.loading = false;
            ed.error = e.message;
          }
          return next;
        });
      }
    }, [t]);
    const reloadFile = React$1.useCallback(async (path, encoding) => {
      const timer = saveTimers.current.get(path);
      if (timer !== void 0) {
        window.clearTimeout(timer);
        saveTimers.current.delete(path);
      }
      documentClosed(path);
      disposeTextModel(models.current.get(path) ?? null);
      models.current.delete(path);
      uriToModelId.delete(uriFor(path));
      await loadFile(path, encoding);
    }, [loadFile]);
    const requestTextMode = React$1.useCallback((path) => {
      var _a3;
      if (!textModeRef.current.has(path)) {
        const next = new Set(textModeRef.current);
        next.add(path);
        textModeRef.current = next;
        setTextMode(next);
        (_a3 = props.onModeChange) == null ? void 0 : _a3.call(props, path, "edit");
      }
      void loadFile(path);
    }, [loadFile]);
    const exitTextMode = React$1.useCallback((path) => {
      var _a3;
      const next = new Set(textModeRef.current);
      if (next.delete(path)) {
        textModeRef.current = next;
        setTextMode(next);
        (_a3 = props.onModeChange) == null ? void 0 : _a3.call(props, path, "preview");
      }
    }, []);
    const doSave = React$1.useCallback(async (path, overwrite = false) => {
      var _a3;
      const editor2 = editors.get(path);
      const model = models.current.get(path);
      if (!editor2 || !model) return;
      const content = model.getValue();
      if (!editor2.dirty && content === editor2.originalContent) return;
      if (editor2.binary) return;
      let remoteMtime = editor2.mtime;
      try {
        const fresh = await pageSdk.call("file.content", { path });
        if (fresh) remoteMtime = fresh.mtime;
      } catch {
      }
      if (!overwrite && editor2.mtime > 0 && remoteMtime !== editor2.mtime) {
        setConflict(path);
        return;
      }
      setSaving(true);
      try {
        const r = await pageSdk.call(
          "file.write",
          { path, content, eol: editor2.eol, encoding: editor2.encoding, bom: editor2.bom }
        );
        if (!r.ok) throw new Error(r.error || t("Editor_SaveFailed"));
        setEditors((prev) => {
          const next = new Map(prev);
          const ed = next.get(path);
          if (ed) {
            ed.dirty = false;
            ed.mtime = r.mtime;
            ed.originalContent = content;
            ed.content = content;
          }
          return next;
        });
        externToasted.current.delete(path);
        const now = /* @__PURE__ */ new Date();
        setSavedAt(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
        if (savedTimer.current) window.clearTimeout(savedTimer.current);
        savedTimer.current = window.setTimeout(() => setSavedAt(null), 1600);
        (_a3 = props.onSaved) == null ? void 0 : _a3.call(props);
      } catch (e) {
        pageSdk.toast(t("Editor_SaveFailed"), e.message);
      } finally {
        setSaving(false);
      }
    }, [editors, t]);
    const scheduleAutoSave = React$1.useCallback((path) => {
      if (!autoSaveRef.current) return;
      const timer = saveTimers.current.get(path);
      if (timer) window.clearTimeout(timer);
      const newTimer = window.setTimeout(() => {
        saveTimers.current.delete(path);
        void doSave(path);
      }, 300);
      saveTimers.current.set(path, newTimer);
    }, [doSave]);
    const handleContentChange = React$1.useCallback((path, value) => {
      setEditors((prev) => {
        const next = new Map(prev);
        const ed = next.get(path);
        if (ed) {
          ed.content = value;
          ed.dirty = true;
        }
        return next;
      });
      scheduleAutoSave(path);
      documentChanged(path, value);
    }, [scheduleAutoSave]);
    const closeTabImpl = React$1.useCallback((path) => {
      const timer = saveTimers.current.get(path);
      if (timer) {
        window.clearTimeout(timer);
        saveTimers.current.delete(path);
      }
      documentClosed(path);
      disposeTextModel(models.current.get(path) ?? null);
      models.current.delete(path);
      uriToModelId.delete(uriFor(path));
      const next = new Set(textModeRef.current);
      if (next.delete(path)) {
        textModeRef.current = next;
        setTextMode(next);
        initialModesAppliedRef.current.delete(path);
      }
      props.onCloseTab(path);
    }, []);
    const requestClose = React$1.useCallback((path) => {
      var _a3;
      if (!path) return;
      if ((_a3 = editors.get(path)) == null ? void 0 : _a3.dirty) {
        setConfirmClose(path);
        return;
      }
      closeTabImpl(path);
    }, [editors, closeTabImpl]);
    const handleFsRenamed = React$1.useCallback((oldPath, newPath, isDir) => {
      for (const p of [...models.current.keys()]) {
        if (!fsAffected(oldPath, isDir, p)) continue;
        const np = fsRemap(p, oldPath, newPath, isDir);
        const model = models.current.get(p);
        const value = model.getValue();
        const nModel = createTextModel(np, value);
        models.current.set(np, nModel);
        models.current.delete(p);
        uriToModelId.delete(uriFor(p));
        uriToModelId.set(uriFor(np), nModel.id);
        documentClosed(p);
        documentOpened(np, languageForPath(np), value, nModel);
        const timer = saveTimers.current.get(p);
        if (timer !== void 0) {
          saveTimers.current.delete(p);
          saveTimers.current.set(np, timer);
        }
        setEditors((prev) => {
          const ed = prev.get(p);
          if (!ed) return prev;
          const next = new Map(prev);
          next.delete(p);
          next.set(np, { ...ed, path: np });
          return next;
        });
        setIndentByPath((prev) => {
          const ind = prev.get(p);
          if (!ind) return prev;
          const next = new Map(prev);
          next.delete(p);
          next.set(np, ind);
          return next;
        });
      }
      const nextTextMode = /* @__PURE__ */ new Set();
      for (const p of textModeRef.current) nextTextMode.add(fsAffected(oldPath, isDir, p) ? fsRemap(p, oldPath, newPath, isDir) : p);
      textModeRef.current = nextTextMode;
      setTextMode(nextTextMode);
    }, []);
    const handleFsDeleted = React$1.useCallback((path, isDir) => {
      for (const p of [...models.current.keys()]) {
        if (!fsAffected(path, isDir, p)) continue;
        const timer = saveTimers.current.get(p);
        if (timer !== void 0) {
          window.clearTimeout(timer);
          saveTimers.current.delete(p);
        }
        documentClosed(p);
        disposeTextModel(models.current.get(p) ?? null);
        models.current.delete(p);
        uriToModelId.delete(uriFor(p));
        setEditors((prev) => {
          if (!prev.has(p)) return prev;
          const next = new Map(prev);
          next.delete(p);
          return next;
        });
        setIndentByPath((prev) => {
          if (!prev.has(p)) return prev;
          const next = new Map(prev);
          next.delete(p);
          return next;
        });
      }
      const nextTextMode = new Set([...textModeRef.current].filter((p) => !fsAffected(path, isDir, p)));
      textModeRef.current = nextTextMode;
      setTextMode(nextTextMode);
    }, []);
    React$1.useImperativeHandle(ref, () => ({ handleFsRenamed, handleFsDeleted }), [handleFsRenamed, handleFsDeleted]);
    const batchClose = React$1.useCallback((targets) => {
      var _a3;
      const closable = targets.filter((p) => {
        const tab = props.tabs.find((x) => x.path === p);
        return !(tab == null ? void 0 : tab.pinned);
      });
      const dirtyKept = closable.filter((p) => {
        var _a4;
        return (_a4 = editors.get(p)) == null ? void 0 : _a4.dirty;
      }).length;
      for (const p of closable) {
        if (!((_a3 = editors.get(p)) == null ? void 0 : _a3.dirty)) closeTabImpl(p);
      }
      if (dirtyKept > 0) pageSdk.toast(t("Editor_TabClose"), t("Editor_KeptDirty", dirtyKept));
    }, [editors, closeTabImpl, props.tabs, t]);
    const openHeadDiff = React$1.useCallback(async (path) => {
      try {
        const d = await pageSdk.call("changes.diffFile", { path, staged: false });
        setHeadDiff({ path, diff: d });
      } catch (e) {
        pageSdk.toast(t("Editor_DiffHead"), e.message);
      }
    }, [t]);
    const tabMenu = React$1.useCallback((path) => {
      const tab = props.tabs.find((x) => x.path === path);
      const idx = props.tabs.findIndex((x) => x.path === path);
      const textual = isTextual(path);
      const items = [
        { label: (tab == null ? void 0 : tab.pinned) ? t("Editor_UnpinTab") : t("Editor_PinTab"), action: () => {
          var _a3;
          return (_a3 = props.onTogglePin) == null ? void 0 : _a3.call(props, path);
        } },
        ...textual ? [{ label: t("Editor_OpenInSplit"), action: () => setSplitPath(path) }] : [],
        { sep: true },
        { label: t("Editor_TabClose"), hint: "Ctrl+W", action: () => requestClose(path) },
        { label: t("Editor_TabCloseOthers"), action: () => batchClose(props.tabs.filter((x) => x.path !== path).map((x) => x.path)) },
        { label: t("Editor_TabCloseRight"), action: () => batchClose(props.tabs.slice(idx + 1).map((x) => x.path)) },
        { label: t("Editor_TabCloseAll"), action: () => batchClose(props.tabs.map((x) => x.path)) },
        { sep: true },
        { label: t("Editor_StageFile"), action: () => {
          var _a3;
          return void ((_a3 = props.onStageFile) == null ? void 0 : _a3.call(props, path));
        } },
        { label: t("Editor_DiscardFile"), action: () => setConfirmDiscard(path) },
        { label: t("Editor_DiffHead"), action: () => void openHeadDiff(path) }
      ];
      return items;
    }, [props.tabs, props.onTogglePin, props.onStageFile, requestClose, batchClose, isTextual, openHeadDiff, t]);
    React$1.useEffect(() => {
      const modes = props.initialModes;
      if (!modes) return;
      let changed = false;
      const next = new Set(textModeRef.current);
      for (const [path, mode] of modes) {
        if (initialModesAppliedRef.current.has(path)) continue;
        initialModesAppliedRef.current.add(path);
        if (!viewerForPath(path)) continue;
        const wantEdit = mode === "edit";
        const hasEdit = next.has(path);
        if (wantEdit !== hasEdit) {
          if (wantEdit) next.add(path);
          else next.delete(path);
          changed = true;
        }
      }
      if (changed) {
        textModeRef.current = next;
        setTextMode(next);
      }
    }, [props.initialModes]);
    React$1.useEffect(() => {
      if (props.activeTab) void loadFile(props.activeTab);
    }, [props.activeTab, loadFile]);
    React$1.useEffect(() => {
      if (splitPath) void loadFile(splitPath);
    }, [splitPath, loadFile]);
    React$1.useEffect(() => {
      if (splitPath && !props.tabs.some((tb) => tb.path === splitPath)) setSplitPath(null);
    }, [props.tabs, splitPath]);
    React$1.useEffect(() => {
      if (!props.fsTick) return;
      const paths = [...models.current.keys()];
      if (paths.length === 0) return;
      let cancelled = false;
      void pageSdk.call("file.statMany", { paths }).then((stats) => {
        if (cancelled || !stats) return;
        const fresh = new Map(stats.map((s) => [s.path, s.mtime]));
        for (const [p] of models.current) {
          const fm = fresh.get(p);
          if (fm === void 0) continue;
          const ed = editorsRef.current.get(p);
          if (!ed || ed.binary || ed.loading || fm === ed.mtime) continue;
          if (ed.dirty) {
            if (!externToasted.current.has(p)) {
              externToasted.current.add(p);
              pageSdk.toast(t("Files_Title"), t("Editor_ExternalChangedDirty", p.split("/").pop() ?? p));
            }
          } else {
            void reloadFile(p);
          }
        }
      }).catch(() => {
      });
      return () => {
        cancelled = true;
      };
    }, [props.fsTick, reloadFile, t]);
    React$1.useEffect(() => {
      const handler = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "s") {
          e.preventDefault();
          if (props.activeTab) void doSave(props.activeTab);
        } else if ((e.ctrlKey || e.metaKey) && e.key === "w") {
          e.preventDefault();
          requestClose(props.activeTab);
        } else if (e.ctrlKey && e.key === "Tab") {
          e.preventDefault();
          if (props.tabs.length > 1) {
            const idx = props.activeTab ? props.tabs.findIndex((x) => x.path === props.activeTab) : -1;
            props.onActivateTab(props.tabs[(idx + 1) % props.tabs.length].path);
          }
        }
      };
      window.addEventListener("keydown", handler);
      return () => window.removeEventListener("keydown", handler);
    }, [props.activeTab, props.tabs, props.onActivateTab, doSave, requestClose]);
    React$1.useEffect(() => () => {
      for (const p of [...models.current.keys()]) uriToModelId.delete(uriFor(p));
      for (const m of models.current.values()) m.dispose();
      models.current.clear();
      for (const timer of saveTimers.current.values()) window.clearTimeout(timer);
      if (savedTimer.current) window.clearTimeout(savedTimer.current);
    }, []);
    const nameOf = (path) => path.split("/").pop() ?? path;
    const requestReopen = React$1.useCallback((path, enc) => {
      var _a3;
      if ((_a3 = editors.get(path)) == null ? void 0 : _a3.dirty) {
        setConfirmReopen({ path, enc });
        return;
      }
      void reloadFile(path, enc);
    }, [editors, reloadFile]);
    const switchEol = React$1.useCallback((path) => {
      const ed = editors.get(path);
      const model = models.current.get(path);
      if (!ed || !model) return;
      const crlf = ed.eol !== "crlf";
      model.setEOL(crlf ? editor.EndOfLineSequence.CRLF : editor.EndOfLineSequence.LF);
      setEditors((prev) => {
        const next = new Map(prev);
        const e = next.get(path);
        if (e) e.eol = crlf ? "crlf" : "lf";
        return next;
      });
      handleContentChange(path, model.getValue());
    }, [editors, handleContentChange]);
    const applyIndent = React$1.useCallback((path, insertSpaces, tabSize) => {
      var _a3;
      (_a3 = models.current.get(path)) == null ? void 0 : _a3.updateOptions({ insertSpaces, tabSize });
      setIndentByPath((prev) => {
        const next = new Map(prev);
        next.set(path, { insertSpaces, tabSize });
        return next;
      });
    }, []);
    const problemRows = React$1.useMemo(() => {
      if (!problemsOpen) return [];
      const rows = [];
      for (const [p, m] of models.current) {
        for (const mk of markersOf(m)) {
          rows.push({ path: p, line: mk.startLineNumber, col: mk.startColumn, severity: mk.severity, message: mk.message });
        }
      }
      rows.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
      return rows;
    }, [problemsOpen, markerTick, props.tabs, editors]);
    if (props.tabs.length === 0) {
      const repo = pageSdk.repo();
      return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "edwelcome", children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "edwm", children: "GITTER" }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "list", children: [
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "h", children: t("Editor_WelcomeTitle") }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "wrow", onClick: props.onQuickOpen, children: [
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "nm2", children: t("Editor_WelcomeOpen") }),
            /* @__PURE__ */ jsxRuntime.jsx("kbd", { className: "kbd", children: "Ctrl" }),
            /* @__PURE__ */ jsxRuntime.jsx("kbd", { className: "kbd", children: "P" })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "wrow", onClick: () => props.onQuickOpen, children: [
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "nm2", children: t("Files_GlobalSearch") }),
            /* @__PURE__ */ jsxRuntime.jsx("kbd", { className: "kbd", children: "Ctrl" }),
            /* @__PURE__ */ jsxRuntime.jsx("kbd", { className: "kbd", children: "Shift" }),
            /* @__PURE__ */ jsxRuntime.jsx("kbd", { className: "kbd", children: "F" })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "wrow", onClick: () => pageSdk.navigate("changes"), children: [
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "nm2", children: t("Editor_WelcomeChanges") }),
            /* @__PURE__ */ jsxRuntime.jsx("kbd", { className: "kbd", children: "Ctrl" }),
            /* @__PURE__ */ jsxRuntime.jsx("kbd", { className: "kbd", children: "Shift" }),
            /* @__PURE__ */ jsxRuntime.jsx("kbd", { className: "kbd", children: "G" })
          ] }),
          repo && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "wrow", onClick: () => void pageSdk.call("shell.openPath", { path: repo.workDir, editor: true }), children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "nm2", children: t("Editor_WelcomeExternal") }) })
        ] })
      ] });
    }
    const activeEditor = props.activeTab ? editors.get(props.activeTab) : null;
    const activeModel = props.activeTab ? models.current.get(props.activeTab) ?? null : null;
    const ActiveViewer = props.activeTab && !textMode.has(props.activeTab) ? viewerForPath(props.activeTab) : null;
    const crumbs = props.activeTab ? props.activeTab.split("/") : [];
    const lang = props.activeTab ? languageLabel(languageForPath(props.activeTab)) : "";
    const indent = props.activeTab ? indentByPath.get(props.activeTab) : void 0;
    const encLabel = activeEditor && !activeEditor.binary ? `${activeEditor.encoding.toUpperCase()}${activeEditor.bom ? " BOM" : ""}` : "UTF-8";
    const revealLine = (localReveal && localReveal.path === props.activeTab ? localReveal : null) ?? (props.reveal && props.reveal.path === props.activeTab ? props.reveal : null);
    const splitEditor = splitPath ? editors.get(splitPath) : null;
    const splitModel = splitPath ? models.current.get(splitPath) ?? null : null;
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }, children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "edtabs", style: { background: editorBg }, children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "edtabs-list", children: props.tabs.map((tab) => {
          var _a3;
          const isActive = tab.path === props.activeTab;
          const isDirty = ((_a3 = editors.get(tab.path)) == null ? void 0 : _a3.dirty) ?? false;
          const st = statusOf(tab.path);
          const nmCls = "nm" + (st ? ` ${STATUS_CLS[st] ?? ""}` : "");
          return /* @__PURE__ */ jsxRuntime.jsxs(
            "div",
            {
              className: "edtab" + (isActive ? " active" : "") + (tab.preview ? " preview" : ""),
              style: isActive ? { background: editorBg, borderBottomColor: editorBg } : void 0,
              title: tab.path,
              draggable: true,
              onDragStart: (e) => {
                e.dataTransfer.setData("text/gitter-tab", tab.path);
                e.dataTransfer.effectAllowed = "move";
              },
              onDragOver: (e) => {
                if (e.dataTransfer.types.includes("text/gitter-tab")) e.preventDefault();
              },
              onDrop: (e) => {
                var _a4;
                const from = e.dataTransfer.getData("text/gitter-tab");
                if (from && from !== tab.path) (_a4 = props.onMoveTab) == null ? void 0 : _a4.call(props, from, tab.path);
              },
              onClick: (e) => {
                if (e.altKey && isTextual(tab.path)) {
                  setSplitPath(tab.path);
                  return;
                }
                props.onActivateTab(tab.path);
              },
              onDoubleClick: () => props.onPinTab(tab.path),
              onAuxClick: (e) => {
                if (e.button === 1) requestClose(tab.path);
              },
              onContextMenu: (e) => showMenu(e, tabMenu(tab.path)),
              children: [
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "fico", children: /* @__PURE__ */ jsxRuntime.jsx(FileIcon, { path: tab.path }) }),
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: nmCls, children: nameOf(tab.path) }),
                isDirty && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "dot", title: t("Editor_Unsaved") }),
                tab.pinned ? /* @__PURE__ */ jsxRuntime.jsx(
                  "span",
                  {
                    className: "x",
                    title: t("Editor_UnpinTab"),
                    onClick: (e) => {
                      var _a4;
                      e.stopPropagation();
                      (_a4 = props.onTogglePin) == null ? void 0 : _a4.call(props, tab.path);
                    },
                    children: /* @__PURE__ */ jsxRuntime.jsx(PinIcon, {})
                  }
                ) : /* @__PURE__ */ jsxRuntime.jsx(
                  "span",
                  {
                    className: "x",
                    title: t("Editor_TabClose"),
                    onClick: (e) => {
                      e.stopPropagation();
                      requestClose(tab.path);
                    },
                    children: /* @__PURE__ */ jsxRuntime.jsx(CloseIcon, {})
                  }
                )
              ]
            },
            tab.path
          );
        }) }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "edtabs-acts", children: [
          saving && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "saving", children: t("Editor_Saving") }),
          /* @__PURE__ */ jsxRuntime.jsx(
            "button",
            {
              className: "files-ibtn",
              title: splitPath ? t("Editor_SplitOff") : t("Editor_Split"),
              disabled: !isTextual(props.activeTab),
              onClick: () => {
                if (splitPath) {
                  setSplitPath(null);
                  return;
                }
                if (isTextual(props.activeTab)) setSplitPath(props.activeTab);
              },
              children: /* @__PURE__ */ jsxRuntime.jsx(SplitIcon, {})
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "files-ibtn", title: t("Files_QuickOpen"), onClick: props.onQuickOpen, children: /* @__PURE__ */ jsxRuntime.jsx(SearchIcon, {}) })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "edcrumbs", style: { background: editorBg }, children: [
        crumbs.map((seg, i) => {
          const p = crumbs.slice(0, i + 1).join("/");
          const last = i === crumbs.length - 1;
          return /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { display: "flex", alignItems: "center", gap: 1, minWidth: 0 }, children: [
            i > 0 && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "csep", children: /* @__PURE__ */ jsxRuntime.jsx(ChevronSepIcon, {}) }),
            /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "cseg", title: p, onClick: () => {
              var _a3;
              return (_a3 = props.onReveal) == null ? void 0 : _a3.call(props);
            }, children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "fico", children: last ? /* @__PURE__ */ jsxRuntime.jsx(FileIcon, { path: p }) : /* @__PURE__ */ jsxRuntime.jsx(FolderIcon, { size: 13 }) }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { children: seg })
            ] })
          ] }, p);
        }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "edcrumbs-acts", children: [
          props.showDiff && props.activeTab && isTextual(props.activeTab) && (diffInfo == null ? void 0 : diffInfo.path) === props.activeTab && diffInfo.total > 0 && /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
            /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "edcrumbs-diffcount", title: t("Editor_ChangesProgress", diffInfo.index, diffInfo.total), children: [
              diffInfo.index,
              "/",
              diffInfo.total
            ] }),
            /* @__PURE__ */ jsxRuntime.jsx(
              "button",
              {
                className: "files-ibtn",
                title: t("Editor_PrevChange"),
                onClick: () => {
                  var _a3;
                  return (_a3 = mainEditorRef.current) == null ? void 0 : _a3.jumpDiff(-1);
                },
                children: /* @__PURE__ */ jsxRuntime.jsx(ChevronUpIcon, {})
              }
            ),
            /* @__PURE__ */ jsxRuntime.jsx(
              "button",
              {
                className: "files-ibtn",
                title: t("Editor_NextChange"),
                onClick: () => {
                  var _a3;
                  return (_a3 = mainEditorRef.current) == null ? void 0 : _a3.jumpDiff(1);
                },
                children: /* @__PURE__ */ jsxRuntime.jsx(ChevronDownIcon, {})
              }
            )
          ] }),
          props.activeTab && isTextual(props.activeTab) && /* @__PURE__ */ jsxRuntime.jsx(
            "button",
            {
              className: "files-ibtn",
              title: t("Editor_Outline"),
              onClick: () => {
                var _a3;
                return (_a3 = mainEditorRef.current) == null ? void 0 : _a3.runAction("editor.action.quickOutline");
              },
              children: /* @__PURE__ */ jsxRuntime.jsx(OutlineIcon, {})
            }
          ),
          props.activeTab && textMode.has(props.activeTab) && viewerForPath(props.activeTab) ? /* @__PURE__ */ jsxRuntime.jsx("button", { className: "files-ibtn", title: t("Editor_PreviewMode"), onClick: () => exitTextMode(props.activeTab), children: /* @__PURE__ */ jsxRuntime.jsxs("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [
            /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M1.3 8C2.2 5.9 4.8 3.5 8 3.5S13.8 5.9 14.7 8c-.9 2.1-3.5 4.5-6.7 4.5S2.2 10.1 1.3 8Z", stroke: "currentColor", strokeWidth: "1.2" }),
            /* @__PURE__ */ jsxRuntime.jsx("circle", { cx: "8", cy: "8", r: "1.9", stroke: "currentColor", strokeWidth: "1.2" })
          ] }) }) : props.activeTab && !textMode.has(props.activeTab) && isExternalPreviewPath(props.activeTab) ? /* @__PURE__ */ jsxRuntime.jsx("button", { className: "files-ibtn", title: t("Editor_EditSource"), onClick: () => requestTextMode(props.activeTab), children: /* @__PURE__ */ jsxRuntime.jsxs("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [
            /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M11.3 2.1a1.4 1.4 0 0 1 2 2L6 11.4l-2.8.8.8-2.8 7.3-7.3Z", stroke: "currentColor", strokeWidth: "1.2", strokeLinejoin: "round" }),
            /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M2.5 14h11", stroke: "currentColor", strokeWidth: "1.2", strokeLinecap: "round" })
          ] }) }) : null
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsxs(
        "div",
        {
          style: { flex: 1, overflow: "hidden", position: "relative", minHeight: 0, display: "flex" },
          onDragOver: (e) => {
            if (e.dataTransfer.types.includes("Files")) e.preventDefault();
          },
          onDrop: (e) => {
            var _a3;
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            for (const f of Array.from(e.dataTransfer.files)) {
              const abs = pageSdk.pathForFile(f);
              if (abs) (_a3 = props.onOpenDropped) == null ? void 0 : _a3.call(props, abs);
            }
          },
          children: [
            /* @__PURE__ */ jsxRuntime.jsx("div", { style: { flex: 1, minWidth: 0, position: "relative", overflow: "hidden" }, children: ActiveViewer && props.activeTab ? /* @__PURE__ */ jsxRuntime.jsx(
              ActiveViewer,
              {
                path: props.activeTab,
                onEditText: requestTextMode,
                initialScrollTop: (_c2 = props.initialPreviewScrolls) == null ? void 0 : _c2.get(props.activeTab),
                onScrollTop: (top) => {
                  var _a3;
                  return (_a3 = props.onPreviewScroll) == null ? void 0 : _a3.call(props, props.activeTab, top);
                }
              },
              props.activeTab
            ) : activeEditor && activeEditor.binary ? /* @__PURE__ */ jsxRuntime.jsx("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: 20, textAlign: "center", opacity: 0.7 }, children: t("Editor_ErrorBinary") }) : activeEditor && activeEditor.error && !activeEditor.content ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "ed-note", children: activeEditor.error }) : /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
              (() => {
                var _a3;
                return activeModel ? /* @__PURE__ */ jsxRuntime.jsx(
                  FilesMonacoEditor,
                  {
                    ref: mainEditorRef,
                    model: activeModel,
                    gitBase: (activeEditor == null ? void 0 : activeEditor.gitBase) ?? null,
                    showDiff: props.showDiff,
                    onDiffProgress: (index, total) => setDiffInfo({ path: props.activeTab ?? "", index, total }),
                    revealLine,
                    initialReveal: props.activeTab ? ((_a3 = props.initialReveals) == null ? void 0 : _a3[props.activeTab]) ?? null : null,
                    onChange: (value) => handleContentChange(props.activeTab ?? "", value),
                    onPosition: (p) => {
                      var _a4;
                      setPosition(p);
                      if (props.activeTab) (_a4 = props.onPositionReport) == null ? void 0 : _a4.call(props, props.activeTab, p.line, p.col);
                    },
                    onMarkers: setMarkers
                  }
                ) : activeEditor ? /* @__PURE__ */ jsxRuntime.jsx("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", height: "100%", opacity: 0.7 }, children: "Loading…" }) : null;
              })(),
              (activeEditor == null ? void 0 : activeEditor.loading) && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "ed-loading", children: "Loading…" }),
              (activeEditor == null ? void 0 : activeEditor.error) && !activeEditor.loading && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "ed-note", children: activeEditor.error })
            ] }) }),
            splitPath && /* @__PURE__ */ jsxRuntime.jsxs(
              "div",
              {
                style: {
                  width: "50%",
                  minWidth: 240,
                  flex: "none",
                  display: "flex",
                  flexDirection: "column",
                  borderLeft: "1px solid var(--c-line, rgba(128,128,128,0.25))",
                  background: editorBg,
                  minHeight: 0
                },
                children: [
                  /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6, padding: "3px 8px", fontSize: 12, opacity: 0.8, flex: "none" }, children: [
                    /* @__PURE__ */ jsxRuntime.jsx("span", { className: "fico", children: /* @__PURE__ */ jsxRuntime.jsx(FileIcon, { path: splitPath }) }),
                    /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: splitPath, children: nameOf(splitPath) }),
                    (splitEditor == null ? void 0 : splitEditor.dirty) && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "dot", title: t("Editor_Unsaved") }),
                    /* @__PURE__ */ jsxRuntime.jsx(
                      "span",
                      {
                        className: "x",
                        title: t("Editor_SplitOff"),
                        style: { display: "inline-flex", cursor: "pointer" },
                        onClick: () => setSplitPath(null),
                        children: /* @__PURE__ */ jsxRuntime.jsx(CloseIcon, {})
                      }
                    )
                  ] }),
                  /* @__PURE__ */ jsxRuntime.jsx("div", { style: { flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }, children: splitModel ? /* @__PURE__ */ jsxRuntime.jsx(
                    FilesMonacoEditor,
                    {
                      model: splitModel,
                      gitBase: (splitEditor == null ? void 0 : splitEditor.gitBase) ?? null,
                      showDiff: props.showDiff,
                      onChange: (value) => {
                        if (splitPath) handleContentChange(splitPath, value);
                      }
                    }
                  ) : /* @__PURE__ */ jsxRuntime.jsx("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", height: "100%", opacity: 0.7 }, children: "Loading…" }) })
                ]
              }
            )
          ]
        }
      ),
      problemsOpen && /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: "none", height: 160, borderTop: "1px solid var(--c-line, rgba(128,128,128,0.25))", display: "flex", flexDirection: "column", background: editorBg }, children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", fontSize: 12, opacity: 0.8, flex: "none" }, children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 }, children: t("Editor_ProblemsTitle") }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "x", style: { display: "inline-flex", cursor: "pointer" }, title: t("Common_Close"), onClick: () => setProblemsOpen(false), children: /* @__PURE__ */ jsxRuntime.jsx(CloseIcon, {}) })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { style: { flex: 1, overflow: "auto", padding: "0 10px 8px" }, children: problemRows.length === 0 ? /* @__PURE__ */ jsxRuntime.jsx("div", { style: { opacity: 0.6, fontSize: 12, padding: "6px 2px" }, children: t("Editor_NoProblems") }) : problemRows.map((r, i) => /* @__PURE__ */ jsxRuntime.jsxs(
          "div",
          {
            className: "cseg",
            style: { display: "flex", gap: 8, alignItems: "baseline", padding: "2px 4px", borderRadius: 4, cursor: "pointer", fontSize: 12 },
            title: `${r.path}:${r.line}:${r.col}`,
            onClick: () => {
              props.onActivateTab(r.path);
              setLocalReveal({ path: r.path, line: r.line, ts: Date.now() });
            },
            children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: r.severity === 1 ? "var(--c-red, #e5534b)" : r.severity === 2 ? "var(--c-yellow, #d4a72c)" : "var(--c-link, #4493f8)", flex: "none" }, children: "●" }),
              /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { flex: "none", opacity: 0.75 }, children: [
                nameOf(r.path),
                ":",
                r.line,
                ":",
                r.col
              ] }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: r.message })
            ]
          },
          `${r.path}:${r.line}:${i}`
        )) })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "edfoot", children: [
        savedAt ? /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "it", title: t("Editor_Saved"), children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "ok", children: /* @__PURE__ */ jsxRuntime.jsx(CheckIcon, {}) }),
          " ",
          t("Editor_Saved"),
          " · ",
          savedAt
        ] }) : /* @__PURE__ */ jsxRuntime.jsxs(
          "span",
          {
            className: "it",
            title: t("Editor_ProblemsTitle"),
            style: { cursor: "pointer" },
            onClick: () => setProblemsOpen((v) => !v),
            children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "ok", children: /* @__PURE__ */ jsxRuntime.jsx(CheckIcon, {}) }),
              " ",
              t("Editor_Problems", markers.errors, markers.warnings)
            ]
          }
        ),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "right", children: [
          /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "it", children: [
            "Ln ",
            position.line,
            ", Col ",
            position.col
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx(
            "span",
            {
              className: "it",
              title: t("Editor_Indent"),
              style: { cursor: "pointer" },
              onClick: (e) => {
                if (!props.activeTab) return;
                showMenu(e, [
                  { label: t("Editor_Spaces", 2), action: () => applyIndent(props.activeTab, true, 2) },
                  { label: t("Editor_Spaces", 4), action: () => applyIndent(props.activeTab, true, 4) },
                  { label: t("Editor_Spaces", 8), action: () => applyIndent(props.activeTab, true, 8) },
                  { sep: true },
                  { label: t("Editor_TabsIndent"), action: () => applyIndent(props.activeTab, false, 4) }
                ]);
              },
              children: indent ? indent.insertSpaces ? t("Editor_Spaces", indent.tabSize) : t("Editor_TabsIndent") : t("Editor_Spaces", 4)
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsx(
            "span",
            {
              className: "it",
              title: t("Editor_EncodingTitle"),
              style: { cursor: activeEditor && !activeEditor.binary ? "pointer" : void 0 },
              onClick: (e) => {
                if (!props.activeTab || !activeEditor || activeEditor.binary) return;
                showMenu(e, [
                  { label: "UTF-8" + (activeEditor.encoding === "utf8" ? " ✓" : ""), action: () => requestReopen(props.activeTab, "utf8") },
                  { label: "GBK" + (activeEditor.encoding === "gbk" ? " ✓" : ""), action: () => requestReopen(props.activeTab, "gbk") },
                  { sep: true },
                  { label: t("Editor_ReopenTitle"), disabled: true }
                ]);
              },
              children: encLabel
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsx(
            "span",
            {
              className: "it",
              title: t("Editor_EolTitle"),
              style: { cursor: "pointer" },
              onClick: () => {
                if (props.activeTab) switchEol(props.activeTab);
              },
              children: ((activeEditor == null ? void 0 : activeEditor.eol) ?? "lf").toUpperCase()
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "it", children: lang }),
          activeStatus && /* @__PURE__ */ jsxRuntime.jsx("span", { className: `it st ${STATUS_CLS[activeStatus] ?? ""}`, title: t("Files_StatusTitle"), children: STATUS_LETTER[activeStatus] ?? activeStatus })
        ] })
      ] }),
      confirmClose && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "modal-overlay", onMouseDown: (e) => {
        if (e.target === e.currentTarget) setConfirmClose(null);
      }, children: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "modal", children: [
        /* @__PURE__ */ jsxRuntime.jsx("h3", { children: t("Editor_UnsavedTitle") }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "modal-body", children: t("Editor_UnsavedBody", nameOf(confirmClose)) }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "modal-actions", children: [
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => {
            const p = confirmClose;
            setConfirmClose(null);
            closeTabImpl(p);
          }, children: t("Editor_DontSave") }),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => setConfirmClose(null), children: t("Common_Cancel") }),
          /* @__PURE__ */ jsxRuntime.jsx(
            "button",
            {
              className: "tool-btn primary",
              onClick: async () => {
                const p = confirmClose;
                setConfirmClose(null);
                await doSave(p);
                closeTabImpl(p);
              },
              children: t("Editor_Save")
            }
          )
        ] })
      ] }) }),
      conflict && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "modal-overlay", onMouseDown: (e) => {
        if (e.target === e.currentTarget) setConflict(null);
      }, children: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "modal", children: [
        /* @__PURE__ */ jsxRuntime.jsx("h3", { children: t("Editor_ConflictTitle") }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "modal-body", children: t("Editor_ConflictBody", nameOf(conflict)) }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "modal-actions", children: [
          /* @__PURE__ */ jsxRuntime.jsx(
            "button",
            {
              className: "tool-btn",
              onClick: () => {
                var _a3, _b3;
                const p = conflict;
                setConflict(null);
                const original = ((_a3 = editors.get(p)) == null ? void 0 : _a3.originalContent) ?? "";
                (_b3 = models.current.get(p)) == null ? void 0 : _b3.setValue(original);
                documentChanged(p, original);
                setEditors((prev) => {
                  const n = new Map(prev);
                  const ed = n.get(p);
                  if (ed) {
                    ed.content = ed.originalContent;
                    ed.dirty = false;
                  }
                  return n;
                });
              },
              children: t("Editor_Reload")
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => setConflict(null), children: t("Common_Cancel") }),
          /* @__PURE__ */ jsxRuntime.jsx(
            "button",
            {
              className: "tool-btn primary",
              onClick: () => {
                const p = conflict;
                setConflict(null);
                void doSave(p, true);
              },
              children: t("Editor_Overwrite")
            }
          )
        ] })
      ] }) }),
      confirmReopen && /* @__PURE__ */ jsxRuntime.jsx(
        Modal,
        {
          title: t("Editor_ReopenTitle"),
          confirmText: t("Editor_Reload"),
          onClose: () => setConfirmReopen(null),
          onConfirm: () => {
            const { path, enc } = confirmReopen;
            setConfirmReopen(null);
            void reloadFile(path, enc);
          },
          children: /* @__PURE__ */ jsxRuntime.jsx("div", { children: t("Editor_ReopenDirty", nameOf(confirmReopen.path)) })
        }
      ),
      confirmDiscard && /* @__PURE__ */ jsxRuntime.jsx(
        Modal,
        {
          title: t("Editor_DiscardConfirmTitle"),
          danger: true,
          confirmText: t("Editor_DiscardFile"),
          onClose: () => setConfirmDiscard(null),
          onConfirm: () => {
            var _a3;
            const p = confirmDiscard;
            setConfirmDiscard(null);
            void ((_a3 = props.onDiscardFile) == null ? void 0 : _a3.call(props, p).then((ok) => {
              if (ok) void reloadFile(p);
            }));
          },
          children: /* @__PURE__ */ jsxRuntime.jsx("div", { children: t("Editor_DiscardConfirmBody", nameOf(confirmDiscard)) })
        }
      ),
      headDiff && /* @__PURE__ */ jsxRuntime.jsx(
        Modal,
        {
          title: `${t("Editor_DiffHead")} · ${nameOf(headDiff.path)}`,
          width: 900,
          confirmText: t("Common_Close"),
          onClose: () => setHeadDiff(null),
          onConfirm: () => setHeadDiff(null),
          children: /* @__PURE__ */ jsxRuntime.jsx("div", { style: { maxHeight: "65vh", overflow: "auto" }, children: /* @__PURE__ */ jsxRuntime.jsx(DiffView, { diff: headDiff.diff, inline: true }) })
        }
      ),
      menuElement
    ] });
  });
  const ROW_H = 30;
  const SEPARATORS = "/\\-_. ";
  function fuzzyMatch(q, s) {
    const pos = [];
    let i = 0;
    for (let j = 0; j < s.length && i < q.length; j++) {
      if (s[j] === q[i]) {
        pos.push(j);
        i++;
      }
    }
    return i === q.length ? pos : null;
  }
  function scoreOf(path, pos) {
    const bStart = path.lastIndexOf("/") + 1;
    let score = 0;
    for (let k = 0; k < pos.length; k++) {
      const i = pos[k];
      score += 2;
      if (i === 0 || SEPARATORS.includes(path[i - 1])) score += 6;
      if (k > 0 && pos[k - 1] === i - 1) score += 8;
      if (i >= bStart) score += 4;
    }
    if (pos.length > 0 && pos[0] === bStart) score += 25;
    score -= Math.min(path.length, 80) * 0.05;
    return score;
  }
  function hl(s, indices) {
    if (indices.length === 0) return s;
    const out = [];
    let last = 0;
    for (const i of indices) {
      if (i > last) out.push(s.slice(last, i));
      out.push(/* @__PURE__ */ jsxRuntime.jsx("mark", { children: s[i] }, i));
      last = i + 1;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
  }
  function QuickOpen(props) {
    const t = pageSdk.t;
    const [query, setQuery] = React$1.useState("");
    const [sel, setSel] = React$1.useState(0);
    const inputRef = React$1.useRef(null);
    const listRef = React$1.useRef(null);
    const rootRef = React$1.useRef(null);
    const q = query.trim().toLowerCase();
    const items = React$1.useMemo(() => {
      const hits = [];
      if (!q) {
        for (const f of props.files) hits.push({ path: f, pos: [], score: 0 });
      } else {
        for (const f of props.files) {
          const pos = fuzzyMatch(q, f.toLowerCase());
          if (pos) hits.push({ path: f, pos, score: scoreOf(f, pos) });
        }
      }
      return hits.sort((a, b) => a.score !== b.score ? b.score - a.score : a.path.localeCompare(b.path));
    }, [props.files, q]);
    const virtualizer = useVirtualizer({
      count: items.length,
      getScrollElement: () => listRef.current,
      estimateSize: () => ROW_H,
      overscan: 8
    });
    React$1.useEffect(() => setSel(0), [query]);
    React$1.useEffect(() => {
      var _a2;
      return (_a2 = inputRef.current) == null ? void 0 : _a2.focus();
    }, []);
    React$1.useEffect(() => {
      if (items.length > 0) virtualizer.scrollToIndex(sel, { align: "auto" });
    }, [sel]);
    const onCloseRef = React$1.useRef(props.onClose);
    onCloseRef.current = props.onClose;
    React$1.useEffect(() => {
      const onDown = (e) => {
        if (rootRef.current && !rootRef.current.contains(e.target)) onCloseRef.current();
      };
      document.addEventListener("mousedown", onDown);
      return () => document.removeEventListener("mousedown", onDown);
    }, []);
    const pick = (path) => {
      if (!path) return;
      props.onOpen(path);
      props.onClose();
    };
    const bStartOf = (p) => p.lastIndexOf("/") + 1;
    const rows = virtualizer.getVirtualItems().map((vi) => {
      const hit = items[vi.index];
      const bStart = bStartOf(hit.path);
      const base = hit.path.slice(bStart);
      const dir = bStart > 0 ? hit.path.slice(0, bStart - 1) : "";
      const basePos = [];
      const dirPos = [];
      for (const i of hit.pos) (i >= bStart ? basePos : dirPos).push(i >= bStart ? i - bStart : i);
      return /* @__PURE__ */ jsxRuntime.jsxs(
        "div",
        {
          className: "qrow" + (vi.index === sel ? " sel" : ""),
          style: { position: "absolute", top: 0, left: 0, right: 0, height: ROW_H, transform: `translateY(${vi.start}px)` },
          onMouseEnter: () => setSel(vi.index),
          onClick: () => pick(hit.path),
          children: [
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "fico", style: { display: "inline-flex" }, children: /* @__PURE__ */ jsxRuntime.jsx(FileIcon, { path: hit.path }) }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "nm", children: hl(base, basePos) }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "p", children: dir ? hl(dir, dirPos) : null })
          ]
        },
        hit.path
      );
    });
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "qo", ref: rootRef, role: "dialog", "aria-label": t("Files_QuickOpen"), children: [
      /* @__PURE__ */ jsxRuntime.jsx(
        "input",
        {
          ref: inputRef,
          type: "text",
          placeholder: t("Files_QuickOpen"),
          value: query,
          spellCheck: false,
          onChange: (e) => setQuery(e.target.value),
          onKeyDown: (e) => {
            var _a2;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((v) => Math.min(v + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((v) => Math.max(v - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick((_a2 = items[Math.min(sel, items.length - 1)]) == null ? void 0 : _a2.path);
            } else if (e.key === "Escape") {
              e.stopPropagation();
              props.onClose();
            }
          }
        }
      ),
      /* @__PURE__ */ jsxRuntime.jsx("div", { className: "qlist", ref: listRef, children: items.length === 0 ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "qempty", children: t("Files_NoMatch") }) : /* @__PURE__ */ jsxRuntime.jsx("div", { style: { height: virtualizer.getTotalSize(), position: "relative" }, children: rows }) }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "qhint", children: [
        /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
          /* @__PURE__ */ jsxRuntime.jsx("kbd", { className: "kbd", children: "↑" }),
          " ",
          /* @__PURE__ */ jsxRuntime.jsx("kbd", { className: "kbd", children: "↓" }),
          " ",
          t("Common_Choose")
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
          /* @__PURE__ */ jsxRuntime.jsx("kbd", { className: "kbd", children: "Enter" }),
          " ",
          t("Files_TreeOpen")
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
          /* @__PURE__ */ jsxRuntime.jsx("kbd", { className: "kbd", children: "Esc" }),
          " ",
          t("Common_Close")
        ] }),
        q && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "qcount", children: t("Files_FilterMatches", items.length) })
      ] })
    ] });
  }
  function plainSource(q) {
    return q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function buildRegex(q, regexMode, caseSensitive) {
    try {
      return new RegExp(regexMode ? q : plainSource(q), caseSensitive ? "g" : "gi");
    } catch {
      return null;
    }
  }
  function highlightLine(text, re) {
    const out = [];
    const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let last = 0;
    let m;
    let key = 0;
    while ((m = rx.exec(text)) !== null) {
      if (m.index > last) out.push(text.slice(last, m.index));
      out.push(/* @__PURE__ */ jsxRuntime.jsx("mark", { children: m[0].length > 0 ? m[0] : text[m.index] ?? "" }, key++));
      last = m.index + Math.max(m[0].length, 1);
      if (!rx.global) break;
      if (m[0].length === 0) rx.lastIndex++;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }
  function GlobalSearch(props) {
    const t = pageSdk.t;
    const [query, setQuery] = React$1.useState("");
    const [replaceOpen, setReplaceOpen] = React$1.useState(false);
    const [replaceWith, setReplaceWith] = React$1.useState("");
    const [caseSensitive, setCaseSensitive] = React$1.useState(false);
    const [regexMode, setRegexMode] = React$1.useState(false);
    const [busy, setBusy] = React$1.useState(false);
    const [replacing, setReplacing] = React$1.useState(false);
    const [error, setError] = React$1.useState(null);
    const [hits, setHits] = React$1.useState([]);
    const [truncated, setTruncated] = React$1.useState(false);
    const inputRef = React$1.useRef(null);
    const rootRef = React$1.useRef(null);
    const seqRef = React$1.useRef(0);
    React$1.useEffect(() => {
      var _a2;
      return (_a2 = inputRef.current) == null ? void 0 : _a2.focus();
    }, []);
    React$1.useEffect(() => {
      const onDown = (e) => {
        if (rootRef.current && !rootRef.current.contains(e.target)) props.onClose();
      };
      document.addEventListener("mousedown", onDown);
      return () => document.removeEventListener("mousedown", onDown);
    }, [props]);
    const q = query.trim();
    const rx = q ? buildRegex(q, regexMode, caseSensitive) : null;
    const runSearch = React$1.useCallback(async () => {
      const queryNow = query.trim();
      const seq = ++seqRef.current;
      if (!queryNow) {
        setHits([]);
        setTruncated(false);
        setError(null);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const r = await pageSdk.call(
          "repo.search",
          { query: queryNow, regex: regexMode, caseSensitive, max: 300 }
        );
        if (seq !== seqRef.current) return;
        if (!r || !Array.isArray(r.matches)) throw new Error((r == null ? void 0 : r.error) || t("Files_SearchFailed"));
        setHits(r.matches);
        setTruncated(!!r.truncated);
      } catch (e) {
        if (seq !== seqRef.current) return;
        setError(e.message);
        setHits([]);
        setTruncated(false);
      } finally {
        if (seq === seqRef.current) setBusy(false);
      }
    }, [query, regexMode, caseSensitive, t]);
    React$1.useEffect(() => {
      if (!q) {
        setHits([]);
        setTruncated(false);
        return;
      }
      const timer = window.setTimeout(() => void runSearch(), 400);
      return () => window.clearTimeout(timer);
    }, [q, caseSensitive, regexMode, runSearch]);
    const replaceAll = React$1.useCallback(async () => {
      var _a2;
      if (!q || !rx || replacing) return;
      const files = [...new Set(hits.map((h) => h.file))];
      const total = hits.length;
      if (files.length === 0) return;
      if (!window.confirm(t("Files_ReplaceConfirm", files.length, total))) return;
      setReplacing(true);
      let doneFiles = 0;
      let doneCount = 0;
      const apply = new RegExp(rx.source, "g");
      for (const f of files) {
        try {
          const r = await pageSdk.call("file.content", { path: f, encoding: void 0 });
          if (!r || !r.content) continue;
          let count = 0;
          const next = r.content.replace(apply, () => {
            count++;
            return replaceWith;
          });
          if (count === 0) continue;
          const w = await pageSdk.call("file.write", {
            path: f,
            content: next,
            eol: r.eol,
            encoding: r.encoding,
            bom: r.bom
          });
          if (w == null ? void 0 : w.ok) {
            doneFiles++;
            doneCount += count;
          }
        } catch {
        }
      }
      setReplacing(false);
      pageSdk.toast(t("Files_ReplaceAll"), t("Files_Replaced", doneCount, doneFiles));
      (_a2 = props.onReplaced) == null ? void 0 : _a2.call(props);
      void runSearch();
    }, [q, rx, hits, replaceWith, replacing, runSearch, props, t]);
    const fileCount = new Set(hits.map((h) => h.file)).size;
    return /* @__PURE__ */ jsxRuntime.jsx("div", { style: { position: "absolute", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.28)", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 42 }, children: /* @__PURE__ */ jsxRuntime.jsxs(
      "div",
      {
        ref: rootRef,
        style: {
          width: 640,
          maxWidth: "92%",
          maxHeight: "70%",
          display: "flex",
          flexDirection: "column",
          borderRadius: 8,
          border: "1px solid var(--c-border)",
          background: "var(--c-panel, var(--c-base))",
          boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
          overflow: "hidden"
        },
        children: [
          /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6, padding: "8px 10px 4px" }, children: [
            /* @__PURE__ */ jsxRuntime.jsx(
              "input",
              {
                ref: inputRef,
                type: "text",
                value: query,
                placeholder: t("Files_SearchContent"),
                spellCheck: false,
                style: { flex: 1, background: "transparent", border: "none", outline: "none", color: "inherit", fontSize: 13 },
                onChange: (e) => setQuery(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void runSearch();
                  } else if (e.key === "Escape") {
                    e.stopPropagation();
                    props.onClose();
                  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "h") {
                    e.preventDefault();
                    setReplaceOpen(true);
                  }
                }
              }
            ),
            /* @__PURE__ */ jsxRuntime.jsx(
              "button",
              {
                className: "files-ibtn" + (caseSensitive ? " on" : ""),
                title: t("Files_SearchCaseSensitive"),
                style: { width: 24, height: 24, fontSize: 12, fontWeight: 700 },
                onClick: () => setCaseSensitive((v) => !v),
                children: "Aa"
              }
            ),
            /* @__PURE__ */ jsxRuntime.jsx(
              "button",
              {
                className: "files-ibtn" + (regexMode ? " on" : ""),
                title: t("Files_SearchRegex"),
                style: { width: 24, height: 24, fontSize: 12, fontWeight: 700 },
                onClick: () => setRegexMode((v) => !v),
                children: ".*"
              }
            ),
            /* @__PURE__ */ jsxRuntime.jsx(
              "button",
              {
                className: "files-ibtn",
                title: t("Files_SearchReplace"),
                style: { width: 24, height: 24 },
                onClick: () => setReplaceOpen((v) => !v),
                children: /* @__PURE__ */ jsxRuntime.jsx("svg", { width: "13", height: "13", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M3 3.5h7M3 6.5h4M12 9.5l2 2-2 2M6 12.5h4", stroke: "currentColor", strokeWidth: "1.2", strokeLinecap: "round" }) })
              }
            ),
            /* @__PURE__ */ jsxRuntime.jsx("button", { className: "files-ibtn", title: t("Common_Close"), style: { width: 24, height: 24 }, onClick: props.onClose, children: /* @__PURE__ */ jsxRuntime.jsx(CloseIcon, {}) })
          ] }),
          replaceOpen && /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6, padding: "0 10px 6px" }, children: [
            /* @__PURE__ */ jsxRuntime.jsx(
              "input",
              {
                type: "text",
                value: replaceWith,
                placeholder: t("Files_SearchReplace"),
                spellCheck: false,
                style: { flex: 1, background: "transparent", border: "none", outline: "none", color: "inherit", fontSize: 13 },
                onChange: (e) => setReplaceWith(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void replaceAll();
                  }
                }
              }
            ),
            /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", disabled: replacing || hits.length === 0, onClick: () => void replaceAll(), children: replacing ? t("Editor_Saving") : t("Files_ReplaceAll") })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx("div", { style: { display: "flex", gap: 8, padding: "2px 12px 6px", fontSize: 11.5, opacity: 0.65 }, children: error ? /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-red, #e5534b)" }, children: error }) : /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
            q && /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
              busy ? t("Files_Searching") : t("Files_FilterMatches", hits.length),
              fileCount > 1 ? ` · ${fileCount} ${t("Files_SearchFiles")}` : ""
            ] }),
            truncated && /* @__PURE__ */ jsxRuntime.jsx("span", { children: t("Files_SearchTruncated", 300) })
          ] }) }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, overflow: "auto", borderTop: "1px solid var(--c-border)", paddingBottom: 6 }, children: [
            hits.map((h, i) => /* @__PURE__ */ jsxRuntime.jsxs(
              "div",
              {
                className: "qrow",
                style: { position: "static", display: "flex", gap: 8, padding: "2px 12px", cursor: "pointer", fontSize: 12.5 },
                title: `${h.file}:${h.line}`,
                onClick: () => props.onOpen(h.file, h.line),
                children: [
                  /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: "none", opacity: 0.65, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: h.file }),
                  /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: "none", opacity: 0.5, fontVariantNumeric: "tabular-nums" }, children: h.line }),
                  /* @__PURE__ */ jsxRuntime.jsx("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: rx ? highlightLine(h.text, rx) : h.text })
                ]
              },
              `${h.file}:${h.line}:${i}`
            )),
            q && !busy && hits.length === 0 && !error && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { padding: "10px 12px", opacity: 0.6, fontSize: 12.5 }, children: t("Files_NoMatch") })
          ] })
        ]
      }
    ) });
  }
  const KEY_PREFIX = "gitter.files.session.v1";
  const TAB_LIMIT = 64;
  const VIEW_LIMIT = 200;
  function keyFor(repo) {
    return KEY_PREFIX + "|" + repo.replace(/\\/g, "/").replace(/\/+$/, "");
  }
  function loadSession(repo) {
    var _a2;
    const empty = { tabs: [], active: null, views: {}, modes: {} };
    let raw = null;
    try {
      raw = window.localStorage.getItem(keyFor(repo));
    } catch {
      return empty;
    }
    if (!raw) return empty;
    try {
      const d = JSON.parse(raw);
      const tabs = Array.isArray(d.tabs) ? d.tabs.filter((x) => !!x && typeof x.path === "string").slice(0, TAB_LIMIT).map((x) => ({ path: x.path, pinned: x.pinned === true })) : [];
      const views = {};
      if (d.views && typeof d.views === "object") {
        for (const [k, v] of Object.entries(d.views)) {
          if (!v || typeof v !== "object") continue;
          const anchor = v.anchor;
          const vs = {};
          if (v.monaco && typeof v.monaco === "object") vs.monaco = v.monaco;
          if (anchor && typeof anchor.line === "number" && typeof anchor.col === "number") {
            vs.anchor = { line: anchor.line, col: anchor.col, text: typeof anchor.text === "string" ? anchor.text : "" };
          }
          if (typeof v.previewScroll === "number" && Number.isFinite(v.previewScroll)) vs.previewScroll = v.previewScroll;
          if (vs.monaco || vs.anchor || vs.previewScroll !== void 0) views[k] = vs;
        }
      }
      const modes = {};
      if (d.modes && typeof d.modes === "object") {
        for (const [k, v] of Object.entries(d.modes)) {
          if (v === "edit" || v === "preview") modes[k] = v;
        }
      }
      const active = typeof d.active === "string" && d.active ? d.active : null;
      return { tabs, active: active ?? ((_a2 = tabs[0]) == null ? void 0 : _a2.path) ?? null, views, modes };
    } catch {
      try {
        window.localStorage.setItem(keyFor(repo), JSON.stringify(empty));
      } catch {
      }
      return empty;
    }
  }
  function saveSession(repo, s) {
    const tabs = s.tabs.slice(0, TAB_LIMIT);
    const views = {};
    let n = 0;
    for (const [k, v] of Object.entries(s.views)) {
      if (n >= VIEW_LIMIT) break;
      if (v.monaco || v.anchor || v.previewScroll !== void 0) {
        const out2 = {};
        if (v.monaco) out2.monaco = v.monaco;
        if (v.anchor) out2.anchor = v.anchor;
        if (v.previewScroll !== void 0) out2.previewScroll = v.previewScroll;
        views[k] = out2;
        n++;
      }
    }
    const modes = {};
    for (const [k, v] of Object.entries(s.modes ?? {})) {
      if (v === "edit" || v === "preview") modes[k] = v;
    }
    const out = {
      tabs,
      active: s.active && tabs.some((t) => t.path === s.active) ? s.active : null,
      views,
      modes
    };
    try {
      window.localStorage.setItem(keyFor(repo), JSON.stringify(out));
    } catch {
      try {
        window.localStorage.setItem(keyFor(repo), JSON.stringify({ ...out, views: {} }));
      } catch {
      }
    }
  }
  const SIDEBAR_KEY = "gitter.files.sidebar.v2";
  const SIDEBAR_DEFAULT = 248;
  const SIDEBAR_MIN = 170;
  const SIDEBAR_MAX = 520;
  function loadWidth() {
    const raw = window.localStorage.getItem(SIDEBAR_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n)) : SIDEBAR_DEFAULT;
  }
  function loadRepoSession(repo) {
    return repo ? loadSession(repo.workDir) : { tabs: [], active: null, views: {}, modes: {} };
  }
  function monacoUriFor(path) {
    return "file://" + path.replace(/\\/g, "/");
  }
  const ANCHOR_WINDOW = 40;
  const ANCHOR_MAX_DRIFT = 3;
  async function resolveAnchor(repo, rel, line, col, text) {
    const clamp = (max) => Math.max(1, Math.min(line, max || 1));
    try {
      const r = await pageSdk.call("file.content", { path: rel, maxBytes: 2 * 1024 * 1024 });
      if (!r) return line;
      const lines = r.content.split("\n");
      if (lines.length === 0) return 1;
      const target = (text || "").trimEnd();
      if (target && target.length >= 3 && target.length <= 200) {
        const win = Math.min(ANCHOR_WINDOW, Math.floor(lines.length / 2));
        const from = Math.max(0, line - 1 - win);
        const to = Math.min(lines.length, line + win);
        let best = -1;
        let bestDist = Infinity;
        for (let i = from; i < to; i++) {
          if ((lines[i] || "").trimEnd() === target) {
            const d = Math.abs(i + 1 - line);
            if (d < bestDist) {
              bestDist = d;
              best = i + 1;
            }
          }
        }
        if (best > 0 && bestDist <= ANCHOR_MAX_DRIFT) return best;
      }
      return clamp(lines.length);
    } catch {
      return line;
    }
  }
  function FilesPage() {
    var _a2;
    const [treeData, setTreeData] = React$1.useState({ entries: [], hasMore: false });
    const [tabs, setTabs] = React$1.useState(() => {
      const s = loadRepoSession(pageSdk.repo());
      return s.tabs.map((t) => ({ path: t.path, preview: !t.pinned, pinned: t.pinned }));
    });
    const [activeTab, setActiveTab] = React$1.useState(() => {
      var _a3;
      const s = loadRepoSession(pageSdk.repo());
      return s.tabs.some((t) => t.path === s.active) ? s.active : ((_a3 = s.tabs[0]) == null ? void 0 : _a3.path) ?? null;
    });
    const [loading, setLoading] = React$1.useState(false);
    const [width, setWidth] = React$1.useState(loadWidth);
    const [collapsed, setCollapsed] = React$1.useState(false);
    const [quickOpen, setQuickOpen] = React$1.useState(false);
    const [revealTick, setRevealTick] = React$1.useState(0);
    const [treeMode, setTreeMode] = React$1.useState("all");
    const [globalSearch, setGlobalSearch] = React$1.useState(false);
    const [reveal, setReveal] = React$1.useState(null);
    const [fsTick, setFsTick] = React$1.useState(0);
    const repo = pageSdk.repo();
    const repoKey = (repo == null ? void 0 : repo.workDir) ?? "";
    const tabsRef = React$1.useRef(tabs);
    tabsRef.current = tabs;
    const activeTabRef = React$1.useRef(activeTab);
    activeTabRef.current = activeTab;
    const quickOpenRef = React$1.useRef(quickOpen);
    quickOpenRef.current = quickOpen;
    const editorRef = React$1.useRef(null);
    const sessionsRef = React$1.useRef({});
    (_a2 = sessionsRef.current)[repoKey] ?? (_a2[repoKey] = loadRepoSession(repo));
    const session = sessionsRef.current[repoKey];
    const sessionSeqRef = React$1.useRef(0);
    const pendingAnchorRef = React$1.useRef(/* @__PURE__ */ new Map());
    const fillAnchorText = React$1.useCallback(async (uri) => {
      const item = pendingAnchorRef.current.get(uri);
      const s = sessionsRef.current[repoKey];
      if (!item || !s) return;
      try {
        const r = await pageSdk.call("file.content", { path: item.path, maxBytes: 2 * 1024 * 1024 });
        if (!r) return;
        const lines = r.content.split("\n");
        const line = Math.max(1, Math.min(item.line, lines.length || 1));
        const text = (lines[line - 1] ?? "").trimEnd();
        const v = s.views[uri];
        if (!text) {
          pendingAnchorRef.current.delete(uri);
          return;
        }
        if (!(v == null ? void 0 : v.anchor)) return;
        v.anchor.text = text;
        pendingAnchorRef.current.delete(uri);
        saveSession(repoKey, s);
      } catch {
      }
    }, [repoKey]);
    React$1.useEffect(() => {
      if (!repoKey) return;
      const s = sessionsRef.current[repoKey];
      if (!s) return;
      s.tabs = tabs.map((t) => ({ path: t.path, pinned: !!t.pinned }));
      s.active = tabs.some((t) => t.path === activeTab) ? activeTab : null;
      saveSession(repoKey, s);
    }, [repoKey, tabs, activeTab]);
    const repoKeyRef = React$1.useRef(repoKey);
    repoKeyRef.current = repoKey;
    const positionReport = React$1.useCallback((path, line, col) => {
      var _a3, _b2;
      const rk = repoKeyRef.current;
      const s = sessionsRef.current[rk];
      if (!s) return;
      const uri = monacoUriFor(path);
      const v = (_a3 = s.views)[uri] ?? (_a3[uri] = {});
      v.anchor = { line, col, text: ((_b2 = v.anchor) == null ? void 0 : _b2.text) ?? "" };
      if (!v.anchor.text) {
        pendingAnchorRef.current.set(uri, { path, line, col });
        void fillAnchorText(uri);
      }
      saveSession(rk, s);
    }, [fillAnchorText]);
    const modeReport = React$1.useCallback((path, mode) => {
      const s = sessionsRef.current[repoKey];
      if (!s) return;
      if (!s.modes) s.modes = {};
      if (s.modes[path] === mode) return;
      s.modes[path] = mode;
      saveSession(repoKey, s);
    }, [repoKey]);
    const previewScrollReport = React$1.useCallback((path, top) => {
      var _a3;
      const s = sessionsRef.current[repoKey];
      if (!s) return;
      const uri = monacoUriFor(path);
      const v = (_a3 = s.views)[uri] ?? (_a3[uri] = {});
      if (v.previewScroll === top) return;
      v.previewScroll = top;
      saveSession(repoKey, s);
    }, [repoKey]);
    React$1.useEffect(() => () => {
      if (repoKey && sessionsRef.current[repoKey]) saveSession(repoKey, sessionsRef.current[repoKey]);
    }, [repoKey]);
    const [initialReveals, setInitialReveals] = React$1.useState(null);
    React$1.useEffect(() => {
      if (!repoKey || !repo) {
        setInitialReveals(null);
        return;
      }
      let cancelled = false;
      const paths = tabs.map((t) => t.path);
      (async () => {
        const out = {};
        for (const p of paths) {
          const v = session.views[monacoUriFor(p)];
          if (!(v == null ? void 0 : v.anchor)) continue;
          const line = await resolveAnchor(repo.workDir, p, v.anchor.line, v.anchor.col, v.anchor.text);
          out[p] = { line, col: v.anchor.col, ts: ++sessionSeqRef.current };
        }
        if (!cancelled) setInitialReveals(Object.keys(out).length > 0 ? out : null);
      })();
      return () => {
        cancelled = true;
      };
    }, [repoKey, tabs.map((t) => t.path).join("|")]);
    const initialModes = React$1.useMemo(() => {
      if (!session.modes || Object.keys(session.modes).length === 0) return null;
      const m = /* @__PURE__ */ new Map();
      for (const p of tabs) {
        const mode = session.modes[p.path];
        if (mode) m.set(p.path, mode);
      }
      return m.size > 0 ? m : null;
    }, [session.modes, tabs.map((t) => t.path).join("|")]);
    const initialPreviewScrolls = React$1.useMemo(() => {
      var _a3;
      const m = /* @__PURE__ */ new Map();
      for (const p of tabs) {
        const top = (_a3 = session.views[monacoUriFor(p.path)]) == null ? void 0 : _a3.previewScroll;
        if (typeof top === "number" && Number.isFinite(top)) m.set(p.path, top);
      }
      return m.size > 0 ? m : null;
    }, [session.views, tabs.map((t) => t.path).join("|")]);
    const loadTree = React$1.useCallback(async () => {
      if (!repo) return;
      setLoading(true);
      try {
        const r = await pageSdk.call("repo.tree", {
          prefix: "",
          taskId: null
        });
        setTreeData({ entries: r.entries ?? [], hasMore: r.hasMore ?? false });
      } catch (e) {
        pageSdk.toast(pageSdk.t("Files_Title"), e.message);
      } finally {
        setLoading(false);
      }
    }, [repo]);
    React$1.useEffect(() => {
      void loadTree();
    }, [loadTree]);
    const fsTimer = React$1.useRef(null);
    React$1.useEffect(() => {
      const off = pageSdk.on("fs.changed", () => {
        if (fsTimer.current) window.clearTimeout(fsTimer.current);
        fsTimer.current = window.setTimeout(() => {
          fsTimer.current = null;
          void loadTree();
          setFsTick((v) => v + 1);
        }, 800);
      });
      return () => {
        if (fsTimer.current) window.clearTimeout(fsTimer.current);
        off();
      };
    }, [loadTree]);
    const openFile = React$1.useCallback((path, opts) => {
      const preview = (opts == null ? void 0 : opts.preview) !== false;
      setTabs((prev) => {
        const i = prev.findIndex((x) => x.path === path);
        if (i >= 0) {
          if (!preview && prev[i].preview) {
            const n = prev.slice();
            n[i] = { path, preview: false };
            return n;
          }
          return prev;
        }
        const base = preview ? prev.filter((x) => !x.preview) : prev;
        return [...base, { path, preview }];
      });
      setActiveTab(path);
    }, []);
    const activateTab = React$1.useCallback((path) => openFile(path, { preview: false }), [openFile]);
    const fileFocus = useAppState().fileFocus;
    const handledFocusRef = React$1.useRef(0);
    React$1.useEffect(() => {
      if (fileFocus && fileFocus.ts !== handledFocusRef.current) {
        handledFocusRef.current = fileFocus.ts;
        openFile(fileFocus.path, { preview: false });
      }
    }, [fileFocus, openFile]);
    const createEntry = React$1.useCallback(async (dir, name, kind) => {
      if (!repo) return false;
      const rel = dir ? `${dir}/${name}` : name;
      try {
        const r = await pageSdk.call("file.create", { path: rel, kind });
        if (!r.ok) {
          const key = r.error === "exists" ? "Files_CreateExists" : r.error === "invalid_name" ? "Files_InvalidName" : "Files_CreateFailed";
          pageSdk.toast(pageSdk.t("Files_Title"), pageSdk.t(key));
          return false;
        }
        await loadTree();
        if (kind === "file") openFile(rel, { preview: false });
        return true;
      } catch (e) {
        pageSdk.toast(pageSdk.t("Files_Title"), e.message);
        return false;
      }
    }, [repo, loadTree, openFile]);
    const remapTabs = React$1.useCallback((oldPath, newPath, isDir) => {
      var _a3;
      const remap = (p) => p === oldPath ? newPath : isDir && p.startsWith(oldPath + "/") ? newPath + p.slice(oldPath.length) : p;
      setTabs((prev) => prev.map((tb) => ({ ...tb, path: remap(tb.path) })));
      setActiveTab((a) => a ? remap(a) : a);
      (_a3 = editorRef.current) == null ? void 0 : _a3.handleFsRenamed(oldPath, newPath, isDir);
    }, []);
    const renameEntry = React$1.useCallback(async (oldPath, newName, isDir) => {
      try {
        const r = await pageSdk.call("file.rename", { path: oldPath, name: newName });
        if (!r.ok) {
          const key = r.error === "exists" ? "Files_CreateExists" : r.error === "invalid_name" ? "Files_InvalidName" : r.error === "not_found" ? "Files_Missing" : "Files_RenameFailed";
          pageSdk.toast(pageSdk.t("Files_Title"), pageSdk.t(key));
          return false;
        }
        const parent = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/")) : "";
        remapTabs(oldPath, `${parent ? `${parent}/` : ""}${newName}`, isDir);
        await loadTree();
        return true;
      } catch (e) {
        pageSdk.toast(pageSdk.t("Files_Title"), e.message);
        return false;
      }
    }, [loadTree, remapTabs]);
    const deleteEntry = React$1.useCallback(async (path, isDir) => {
      var _a3;
      const affected = (p) => p === path || isDir && p.startsWith(path + "/");
      try {
        const r = await pageSdk.call("file.delete", { path });
        if (!r.ok) {
          const key = r.error === "not_found" ? "Files_Missing" : "Files_DeleteFailed";
          pageSdk.toast(pageSdk.t("Files_Title"), pageSdk.t(key));
          return false;
        }
        const old = tabsRef.current;
        setTabs((prev) => prev.filter((tb) => !affected(tb.path)));
        setActiveTab((a) => {
          var _a4;
          if (!a || !affected(a)) return a;
          const rest = old.filter((tb) => !affected(tb.path));
          const i = old.findIndex((tb) => tb.path === a);
          return ((_a4 = rest[Math.min(i, rest.length - 1)]) == null ? void 0 : _a4.path) ?? null;
        });
        (_a3 = editorRef.current) == null ? void 0 : _a3.handleFsDeleted(path, isDir);
        await loadTree();
        return true;
      } catch (e) {
        pageSdk.toast(pageSdk.t("Files_Title"), e.message);
        return false;
      }
    }, [loadTree]);
    const pasteEntry = React$1.useCallback(async (from, toDir, cut, fromIsDir) => {
      try {
        const r = await pageSdk.call("file.paste", { from, toDir, cut });
        if (!r.ok) {
          const key = r.error === "exists" ? "Files_CreateExists" : r.error === "not_found" ? "Files_Missing" : r.error === "invalid_name" ? "Files_InvalidName" : cut ? "Files_MoveFailed" : "Files_PasteFailed";
          pageSdk.toast(pageSdk.t("Files_Title"), pageSdk.t(key));
          return false;
        }
        await loadTree();
        if (cut) remapTabs(from, r.path, fromIsDir);
        return r.path;
      } catch (e) {
        pageSdk.toast(pageSdk.t("Files_Title"), e.message);
        return false;
      }
    }, [loadTree, remapTabs]);
    const closeTab = React$1.useCallback((path) => {
      const i = tabsRef.current.findIndex((x) => x.path === path);
      if (i < 0) return;
      const next = tabsRef.current.filter((x) => x.path !== path);
      setTabs(next);
      setActiveTab((a) => {
        var _a3;
        return a === path ? ((_a3 = next[Math.min(i, next.length - 1)]) == null ? void 0 : _a3.path) ?? null : a;
      });
    }, []);
    const togglePin = React$1.useCallback((path) => {
      setTabs((prev) => prev.map((tb) => tb.path === path ? { path: tb.path, preview: tb.pinned ? tb.preview : false, pinned: !tb.pinned } : tb));
    }, []);
    const moveTab = React$1.useCallback((from, to) => {
      setTabs((prev) => {
        const fi = prev.findIndex((x) => x.path === from);
        const ti = prev.findIndex((x) => x.path === to);
        if (fi < 0 || ti < 0 || fi === ti) return prev;
        const next = prev.slice();
        const [m] = next.splice(fi, 1);
        next.splice(ti, 0, m);
        return next;
      });
    }, []);
    const stageFile = React$1.useCallback(async (path) => {
      try {
        await pageSdk.call("changes.stage", { paths: [path] });
        await loadTree();
        return true;
      } catch (e) {
        pageSdk.toast(pageSdk.t("Files_Title"), e.message);
        return false;
      }
    }, [loadTree]);
    const discardFile = React$1.useCallback(async (path) => {
      try {
        await pageSdk.call("changes.discardFile", { path });
        await loadTree();
        return true;
      } catch (e) {
        pageSdk.toast(pageSdk.t("Files_Title"), e.message);
        return false;
      }
    }, [loadTree]);
    const openDropped = React$1.useCallback((abs) => {
      if (!repo) return;
      const rel = relOfWork(repo.workDir, abs);
      if (!rel || rel.length === 0) {
        pageSdk.toast(pageSdk.t("Files_Title"), pageSdk.t("Files_OutsideRepo"));
        return;
      }
      openFile(rel, { preview: false });
    }, [repo, openFile]);
    const statusByPath = React$1.useMemo(() => {
      const map = {};
      for (const e of treeData.entries) {
        if (!e.isDir) map[e.path] = e.status;
      }
      return map;
    }, [treeData.entries]);
    const allFiles = React$1.useMemo(() => treeData.entries.filter((e) => !e.isDir).map((e) => e.path), [treeData.entries]);
    React$1.useEffect(() => {
      const handler = (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
        const k = e.key.toLowerCase();
        if (e.shiftKey) {
          if (k === "f") {
            e.preventDefault();
            setGlobalSearch((v) => !v);
          }
          return;
        }
        if (k === "p") {
          e.preventDefault();
          setQuickOpen((v) => !v);
        } else if (k === "b") {
          e.preventDefault();
          setCollapsed((v) => !v);
        }
      };
      window.addEventListener("keydown", handler);
      return () => window.removeEventListener("keydown", handler);
    }, []);
    const dragRef = React$1.useRef(null);
    const onGutterDown = React$1.useCallback((e) => {
      dragRef.current = { startX: e.clientX, startW: width };
      e.target.setPointerCapture(e.pointerId);
      e.target.classList.add("drag");
      document.body.style.userSelect = "none";
      e.preventDefault();
    }, [width]);
    const onGutterMove = React$1.useCallback((e) => {
      const d = dragRef.current;
      if (!d) return;
      setWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, d.startW + e.clientX - d.startX)));
    }, []);
    const onGutterUp = React$1.useCallback((e) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      e.target.releasePointerCapture(e.pointerId);
      e.target.classList.remove("drag");
      document.body.style.userSelect = "";
      setWidth((w) => {
        window.localStorage.setItem(SIDEBAR_KEY, String(w));
        return w;
      });
    }, []);
    if (!repo) {
      return /* @__PURE__ */ jsxRuntime.jsx("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }, children: /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { textAlign: "center", opacity: 0.7 }, children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { style: { fontSize: 32, marginBottom: 8 }, children: "📁" }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { children: pageSdk.t("Files_Empty") })
      ] }) });
    }
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "files-split", children: [
      !collapsed && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "files-side", style: { width, flex: "none" }, children: /* @__PURE__ */ jsxRuntime.jsx(
        TreePane,
        {
          entries: treeData.entries,
          activePath: activeTab,
          onOpenFile: openFile,
          onCreate: createEntry,
          onRename: renameEntry,
          onDelete: deleteEntry,
          onPaste: pasteEntry,
          loading,
          onRefresh: () => void loadTree(),
          onModeChange: setTreeMode,
          revealTick
        },
        repo.workDir
      ) }),
      /* @__PURE__ */ jsxRuntime.jsx(
        "div",
        {
          className: "files-gutter",
          title: pageSdk.t("Files_GutterHint"),
          onPointerDown: onGutterDown,
          onPointerMove: onGutterMove,
          onPointerUp: onGutterUp,
          onLostPointerCapture: onGutterUp,
          onDoubleClick: () => {
            setWidth(SIDEBAR_DEFAULT);
            window.localStorage.setItem(SIDEBAR_KEY, String(SIDEBAR_DEFAULT));
          }
        }
      ),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "files-main", children: [
        /* @__PURE__ */ jsxRuntime.jsx(
          EditorPane,
          {
            ref: editorRef,
            tabs,
            activeTab,
            statusByPath,
            showDiff: treeMode === "git",
            onActivateTab: activateTab,
            onPinTab: activateTab,
            onCloseTab: closeTab,
            onQuickOpen: () => setQuickOpen(true),
            onToggleSidebar: () => setCollapsed(false),
            onReveal: () => setRevealTick((v) => v + 1),
            onSaved: () => void loadTree(),
            onMoveTab: moveTab,
            onTogglePin: togglePin,
            onStageFile: stageFile,
            onDiscardFile: discardFile,
            onOpenDropped: openDropped,
            reveal,
            initialReveals: initialReveals ?? void 0,
            onPositionReport: positionReport,
            initialModes: initialModes ?? void 0,
            onModeChange: modeReport,
            initialPreviewScrolls: initialPreviewScrolls ?? void 0,
            onPreviewScroll: previewScrollReport,
            fsTick
          },
          repoKey
        ),
        quickOpen && /* @__PURE__ */ jsxRuntime.jsx(
          QuickOpen,
          {
            files: allFiles,
            onOpen: (p) => openFile(p, { preview: true }),
            onClose: () => setQuickOpen(false)
          }
        ),
        globalSearch && /* @__PURE__ */ jsxRuntime.jsx(
          GlobalSearch,
          {
            onOpen: (p, line) => {
              openFile(p, { preview: false });
              setReveal({ path: p, line, ts: Date.now() });
            },
            onClose: () => setGlobalSearch(false),
            onReplaced: () => void loadTree()
          }
        )
      ] })
    ] });
  }
  window.GITTER_UI.registerPage({ id: "files" }, (container) => {
    var _a2;
    const host = container;
    (_a2 = host.__gitterRoot) == null ? void 0 : _a2.unmount();
    const root = ReactDOMClient.createRoot(container);
    root.render(
      React.createElement(PageErrorBoundary, {
        pageKey: "files",
        children: React.createElement(FilesPage)
      })
    );
    host.__gitterRoot = root;
    return () => {
      host.__gitterRoot = void 0;
      root.unmount();
    };
  });
})(window.GITTER_KIT.ReactJSXRuntime, window.GITTER_KIT.React, window.GITTER_KIT.ReactDOM);
