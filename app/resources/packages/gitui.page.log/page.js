(function(jsxRuntime, React$1, reactDom) {
  "use strict";
  var _a, _b;
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
        var _a2, _b2, _c;
        return ((_c = (_b2 = (_a2 = this.targetWindow) == null ? void 0 : _a2.performance) == null ? void 0 : _b2.now) == null ? void 0 : _c.call(_b2)) ?? Date.now();
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
        var _a2, _b2, _c;
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
          const shouldAdjustScroll = ((_c = this.scrollState) == null ? void 0 : _c.behavior) !== "smooth" && (this.shouldAdjustScrollPositionOnItemSizeChange !== void 0 ? this.shouldAdjustScrollPositionOnItemSizeChange(
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
  function U() {
    const g = window.GITTER_UI;
    if (!g) throw new Error("GITTER_UI 未注入（外部页必须经宿主 pageLoader 装载）");
    return g;
  }
  const BOOT = ((_b = (_a = window.GITTER_UI) == null ? void 0 : _a.getActiveCaller) == null ? void 0 : _b.call(_a)) ?? null;
  const pageSdk = {
    call: (method, params) => {
      const g = U();
      return BOOT ? g.callWith(BOOT, method, params) : g.call(method, params);
    },
    t: (key, ...args) => U().t(key, ...args),
    navigate: (page) => U().navigate(page),
    refresh: () => U().refresh(),
    setContext: (...a) => U().setContext(...a),
    focusTask: (taskId) => U().focusTask(taskId)
  };
  function useAppState() {
    const g = U();
    return React$1.useSyncExternalStore(g.subscribeState, g.getState);
  }
  async function seamMenuItems(location, filePath) {
    var _a2;
    try {
      const g = window.GITTER_UI;
      if (!g) return [];
      const items = await g.call("menus.list", { location, lang: ((_a2 = g.getState().i18n) == null ? void 0 : _a2.lang) ?? "en", fileSelected: !!filePath });
      return items.map((m) => ({ label: m.title, action: () => void g.runCommand({ id: m.command, title: m.title }, { filePath }) }));
    } catch {
      return [];
    }
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
  K().diffStatusLetter;
  K().renderSegments;
  K().wordDiff;
  const SplitPane = K().SplitPane;
  const Banner = K().Banner;
  const Modal = K().Modal;
  const useContextMenu = K().useContextMenu;
  K().SyncBar;
  K().useSyncProgress;
  K().renderMarkdown;
  K().registerMarkdownPlugin;
  const PageErrorBoundary = K().PageErrorBoundary;
  K().NavIcon;
  const Select = K().Select;
  K().ScrollArea;
  const GAP_WINDOW_MS = 30 * 60 * 1e3;
  function groupSessions(commitsDesc) {
    const sessions = [];
    let current = null;
    let currentAgent = null;
    let currentSessionId = null;
    const flush = () => {
      if (current && current.length >= 2) {
        sessions.push({
          sessionId: currentSessionId ?? `${currentAgent}|${current[current.length - 1].sha}`,
          agentId: currentAgent ?? "ai",
          start: current[current.length - 1].committerDate,
          end: current[0].committerDate,
          commits: current
        });
      }
      current = null;
    };
    for (const c of commitsDesc) {
      const assistedBy = c.assistedBy[0] ?? null;
      if (!assistedBy) {
        flush();
        continue;
      }
      const sameGroup = current !== null && assistedBy === currentAgent && (c.sessionId ? !!currentSessionId && c.sessionId === currentSessionId : currentSessionId === null && current[0].committerDate - c.committerDate <= GAP_WINDOW_MS);
      if (!sameGroup) flush();
      current ?? (current = []);
      currentAgent = assistedBy;
      currentSessionId = c.sessionId;
      current.push(c);
    }
    flush();
    return sessions;
  }
  function squashMessage(s) {
    const tip = s.commits[0];
    const oldest = s.commits[s.commits.length - 1];
    return `${tip.subject}

Squashed ${s.commits.length} checkpoint commits from ${s.agentId} (${oldest.shortSha}..${tip.shortSha}).`;
  }
  const { call, t, navigate, refresh: refreshCurrent, setContext: setSharedContext, focusTask } = pageSdk;
  const useApp = useAppState;
  function dayTitle(day) {
    const today = /* @__PURE__ */ new Date();
    const isSameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const yest = new Date(today.getTime() - 864e5);
    if (isSameDay(day, today)) return t("Log_Today");
    if (isSameDay(day, yest)) return t("Log_Yesterday");
    return day.toLocaleDateString();
  }
  function relativeTime(unix) {
    const diff = Date.now() / 1e3 - unix;
    if (diff < 60) return t("Log_JustNow");
    if (diff < 3600) return t("Log_MinutesAgo", Math.floor(diff / 60));
    if (diff < 86400) return t("Log_HoursAgo", Math.floor(diff / 3600));
    if (diff < 86400 * 30) return t("Log_DaysAgo", Math.floor(diff / 86400));
    return new Date(unix * 1e3).toLocaleDateString();
  }
  function LogPage() {
    var _a2;
    const app = useApp();
    const repo = app.repo;
    const [commits, setCommits] = React$1.useState([]);
    const [hasMore, setHasMore] = React$1.useState(false);
    const [loading, setLoading] = React$1.useState(false);
    const [error, setError] = React$1.useState(null);
    const [branches, setBranches] = React$1.useState({ current: null, names: [] });
    const [branch, setBranch] = React$1.useState("");
    const [query, setQuery] = React$1.useState("");
    const [collapsedDays, setCollapsedDays] = React$1.useState(/* @__PURE__ */ new Set());
    const [collapsedSessions, setCollapsedSessions] = React$1.useState(/* @__PURE__ */ new Set());
    const [selectedSha, setSelectedSha] = React$1.useState(null);
    React$1.useEffect(() => {
      setSharedContext({ selectedCommitSha: selectedSha });
    }, [selectedSha]);
    const [detail, setDetail] = React$1.useState(null);
    const [detailError, setDetailError] = React$1.useState(null);
    const [fileDiff, setFileDiff] = React$1.useState(null);
    const [diffLoading, setDiffLoading] = React$1.useState(false);
    const [compareBase, setCompareBase] = React$1.useState(null);
    const [resetTarget, setResetTarget] = React$1.useState(null);
    const [resetMode, setResetMode] = React$1.useState("mixed");
    const { showMenu, menuElement } = useContextMenu();
    const listRef = React$1.useRef(null);
    const loadPage = React$1.useCallback(
      async (skip, replace) => {
        if (!repo) return;
        setLoading(true);
        setError(null);
        try {
          const r = await call("log.query", {
            branch: branch || void 0,
            query: query || void 0,
            limit: 50,
            skip
          });
          setCommits((prev) => replace ? r.commits : [...prev, ...r.commits]);
          setHasMore(r.hasMore);
        } catch (e) {
          setError(e.message);
        } finally {
          setLoading(false);
        }
      },
      [repo, branch, query]
    );
    const loadBranches = React$1.useCallback(async () => {
      if (!repo) return;
      try {
        const b = await call("log.branches");
        setBranches(b);
        setBranch((cur) => cur || b.current || "");
      } catch {
      }
    }, [repo]);
    React$1.useEffect(() => {
      if (!repo) {
        setCommits([]);
        setDetail(null);
        return;
      }
      void loadBranches();
      setSelectedSha(null);
      setDetail(null);
      setFileDiff(null);
      setCompareBase(null);
    }, [repo, app.refreshTick]);
    React$1.useEffect(() => {
      if (!repo) return;
      const timer = setTimeout(() => void loadPage(0, true), 200);
      return () => clearTimeout(timer);
    }, [repo, branch, query, app.refreshTick]);
    React$1.useEffect(() => {
      if (!repo || !selectedSha) {
        setDetail(null);
        return;
      }
      setFileDiff(null);
      setDetailError(null);
      (async () => {
        try {
          const d = await call("log.detail", { sha: selectedSha, baseSha: compareBase == null ? void 0 : compareBase.sha });
          setDetail(d);
        } catch (e) {
          setDetailError(e.message);
          setDetail(null);
        }
      })();
    }, [repo, selectedSha, compareBase]);
    const rows = React$1.useMemo(() => {
      const sessions = groupSessions(commits);
      const sessionOfSha = /* @__PURE__ */ new Map();
      const sessionHeadSha = /* @__PURE__ */ new Set();
      for (const s of sessions) {
        for (const c of s.commits) sessionOfSha.set(c.sha, s);
        sessionHeadSha.add(s.commits[0].sha);
      }
      const emittedSessions = /* @__PURE__ */ new Set();
      const out = [];
      let curDay = "";
      let dayCollapsed = false;
      let count = 0;
      for (const c of commits) {
        const day = new Date(c.committerDate * 1e3).toISOString().slice(0, 10);
        if (day !== curDay) {
          curDay = day;
          dayCollapsed = collapsedDays.has(day);
          count = 0;
          out.push({ kind: "group", key: curDay, title: dayTitle(new Date(curDay)), count: 0, collapsed: dayCollapsed });
        }
        count++;
        const last = out[out.length - 1];
        if (last.kind === "group") last.count = count;
        if (dayCollapsed) continue;
        const session = sessionOfSha.get(c.sha);
        if (session) {
          if (sessionHeadSha.has(c.sha) && !emittedSessions.has(session.sessionId)) {
            emittedSessions.add(session.sessionId);
            out.push({
              kind: "session",
              key: "sess-" + session.sessionId,
              session,
              collapsed: collapsedSessions.has(session.sessionId)
            });
          }
          if (collapsedSessions.has(session.sessionId)) continue;
        }
        out.push({
          kind: "commit",
          key: c.sha,
          commit: c,
          selected: c.sha === selectedSha,
          meta: `${c.author} · ${relativeTime(c.committerDate)}`,
          ai: c.assistedBy[0]
        });
      }
      return out;
    }, [commits, collapsedDays, collapsedSessions, selectedSha]);
    const virtualizer = useVirtualizer({
      count: rows.length,
      getScrollElement: () => listRef.current,
      estimateSize: (i) => rows[i].kind === "group" ? 26 : rows[i].kind === "session" ? 34 : 44,
      overscan: 12
    });
    React$1.useEffect(() => {
      const el = listRef.current;
      if (!el) return;
      const onScroll = () => {
        if (hasMore && !loading && el.scrollTop + el.clientHeight > el.scrollHeight - 300) {
          void loadPage(commits.length, false);
        }
      };
      el.addEventListener("scroll", onScroll);
      return () => el.removeEventListener("scroll", onScroll);
    }, [hasMore, loading, commits.length, loadPage]);
    const copy = (text) => navigator.clipboard.writeText(text);
    const squash = async (s) => {
      try {
        await call("log.squash", {
          topSha: s.commits[0].sha,
          bottomParentSha: s.commits[s.commits.length - 1].sha,
          message: squashMessage(s)
        });
        setError(null);
        refreshCurrent();
      } catch (e) {
        setError(e.message);
      }
    };
    const doReset = async () => {
      if (!resetTarget) return;
      try {
        await call("log.reset", { sha: resetTarget.sha, mode: resetMode });
        setError(null);
        setResetTarget(null);
        refreshCurrent();
      } catch (e) {
        setError(e.message);
      }
    };
    if (!repo) {
      return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "empty-state", children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "big", children: "⏱" }),
        t("Common_NoProjectSelected")
      ] });
    }
    return /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "toolbar", children: [
        /* @__PURE__ */ jsxRuntime.jsx(
          Select,
          {
            value: branch,
            onChange: (v) => setBranch(v),
            title: t("Log_BranchFilter"),
            options: [.../* @__PURE__ */ new Set([branches.current ?? "", ...branches.names])].filter(Boolean).map((n) => ({ value: n, label: n }))
          }
        ),
        /* @__PURE__ */ jsxRuntime.jsx(
          "input",
          {
            className: "input",
            style: { width: 220 },
            placeholder: t("Log_SearchPlaceholder"),
            value: query,
            onChange: (e) => setQuery(e.target.value)
          }
        ),
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "grow" }),
        loading && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "spinner", children: t("Common_Loading") })
      ] }),
      error && /* @__PURE__ */ jsxRuntime.jsx(Banner, { text: error, error: true, onClose: () => setError(null) }),
      compareBase && detail && /* @__PURE__ */ jsxRuntime.jsx(
        Banner,
        {
          text: t("Log_ComparingWith", compareBase.shortSha),
          onClose: () => setCompareBase(null)
        }
      ),
      /* @__PURE__ */ jsxRuntime.jsx("div", { style: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: "8px 12px 12px" }, children: /* @__PURE__ */ jsxRuntime.jsx(SplitPane, { settingKey: "logSplitterFraction", initial: 0.42, a: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "split-pane", ref: listRef, children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { style: { height: virtualizer.getTotalSize(), position: "relative" }, children: virtualizer.getVirtualItems().map((vi) => {
          const row = rows[vi.index];
          if (row.kind === "group") {
            return /* @__PURE__ */ jsxRuntime.jsxs(
              "div",
              {
                className: "group-header",
                style: { position: "absolute", top: vi.start, left: 0, right: 0, height: vi.size },
                onClick: () => setCollapsedDays((prev) => {
                  const next = new Set(prev);
                  if (next.has(row.key)) next.delete(row.key);
                  else next.add(row.key);
                  return next;
                }),
                children: [
                  /* @__PURE__ */ jsxRuntime.jsx("span", { children: row.collapsed ? "▸" : "▾" }),
                  /* @__PURE__ */ jsxRuntime.jsx("span", { children: row.title }),
                  /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "var(--c-text3)", fontWeight: 400 }, children: row.count })
                ]
              },
              row.key
            );
          }
          if (row.kind === "session") {
            const s = row.session;
            return /* @__PURE__ */ jsxRuntime.jsxs(
              "div",
              {
                className: "list-row session-card",
                style: { position: "absolute", top: vi.start, left: 0, right: 0, height: vi.size, background: "var(--c-chip-purple-bg)" },
                onClick: () => setCollapsedSessions((prev) => {
                  const next = new Set(prev);
                  if (next.has(s.sessionId)) next.delete(s.sessionId);
                  else next.add(s.sessionId);
                  return next;
                }),
                onContextMenu: (e) => showMenu(e, [
                  {
                    label: t("Log_SquashSession", s.commits.length),
                    action: () => void squash(s)
                  },
                  { label: t("Log_CopyAgent"), action: () => copy(s.agentId) },
                  { label: t("Log_OpenTaskCard"), action: () => {
                    focusTask(s.agentId);
                    navigate("tasks");
                  } }
                ]),
                children: [
                  /* @__PURE__ */ jsxRuntime.jsx("span", { children: row.collapsed ? "▸" : "▾" }),
                  /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "badge", style: { background: "var(--c-chip-purple-bg)", color: "var(--c-chip-purple-fg)" }, children: [
                    "AI · ",
                    s.agentId
                  ] }),
                  /* @__PURE__ */ jsxRuntime.jsx("span", { className: "trim", style: { flex: 1, fontWeight: 600 }, children: s.commits[0].subject }),
                  /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "mono", children: [
                    s.commits.length,
                    " checkpoints"
                  ] })
                ]
              },
              row.key
            );
          }
          const c = row.commit;
          return /* @__PURE__ */ jsxRuntime.jsxs(
            "div",
            {
              className: "list-row" + (row.selected ? " selected" : ""),
              style: { position: "absolute", top: vi.start, left: 0, right: 0, height: vi.size },
              onClick: () => setSelectedSha(c.sha),
              onContextMenu: (e) => {
                void (async () => {
                  const local = [
                    { label: t("Log_CopySha"), action: () => copy(c.sha) },
                    { label: t("Log_CopySubject"), action: () => copy(c.subject) },
                    { label: t("Log_CopyAuthor"), action: () => copy(c.author) },
                    { sep: true, label: "", action: () => {
                    } },
                    {
                      label: t("Log_CompareWithSelected"),
                      action: () => setCompareBase((cur) => (cur == null ? void 0 : cur.sha) === c.sha ? null : c)
                    },
                    { label: t("Log_ResetToHere"), action: () => {
                      setResetMode("mixed");
                      setResetTarget(c);
                    } }
                  ];
                  showMenu(e, [...local, ...await seamMenuItems("logRow")]);
                })();
              },
              children: [
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mono", style: { color: "var(--c-text3)" }, children: c.shortSha }),
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "trim", style: { flex: "0 1 auto", minWidth: 0 }, children: c.subject }),
                c.refs.slice(0, 3).map((r) => /* @__PURE__ */ jsxRuntime.jsx("span", { className: "badge" + (r.isTag ? " tag" : ""), children: r.name }, r.name)),
                row.ai && /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "badge tag", children: [
                  "AI · ",
                  row.ai
                ] }),
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "trim", style: { color: "var(--c-text3)", fontSize: 11, maxWidth: 180 }, children: row.meta }),
                /* @__PURE__ */ jsxRuntime.jsx("span", { style: { flex: 1 } })
              ]
            },
            row.key
          );
        }) }),
        hasMore && !loading && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "spinner", children: t("Log_LoadMoreHint") })
      ] }), b: /* @__PURE__ */ jsxRuntime.jsx("div", { className: "split-pane", style: { display: "flex", flexDirection: "column" }, children: detail ? /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { padding: "10px 12px", borderBottom: "1px solid var(--c-border)" }, children: [
          /* @__PURE__ */ jsxRuntime.jsx("div", { style: { fontSize: 14, fontWeight: 600, userSelect: "text" }, children: detail.commit.subject }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { fontSize: 11, color: "var(--c-text2)", marginTop: 4, userSelect: "text" }, children: [
            detail.commit.author,
            " <",
            detail.commit.authorEmail,
            "> · ",
            new Date(detail.commit.authorDate * 1e3).toLocaleString(),
            " · ",
            detail.commit.shortSha
          ] }),
          detail.commit.body.trim() && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { fontSize: 12, color: "var(--c-text2)", marginTop: 6, whiteSpace: "pre-wrap", userSelect: "text" }, children: detail.commit.body.trim() })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { flex: 1, overflow: "auto", minHeight: 0 }, children: [
          detail.files.length === 0 && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "empty-state", children: t("Log_NoFiles") }),
          detail.files.map((f) => /* @__PURE__ */ jsxRuntime.jsx(
            FileRow,
            {
              file: f,
              active: (fileDiff == null ? void 0 : fileDiff.path) === f.path,
              onOpen: async () => {
                setDiffLoading(true);
                try {
                  const d = await call("log.fileDiff", { sha: detail.commit.sha, baseSha: compareBase == null ? void 0 : compareBase.sha, path: f.path });
                  setFileDiff(d);
                } catch (e) {
                  setDetailError(e.message);
                } finally {
                  setDiffLoading(false);
                }
              }
            },
            f.path
          ))
        ] }),
        diffLoading && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "spinner", children: t("Common_Loading") }),
        fileDiff && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { height: "55%", overflow: "auto", borderTop: "1px solid var(--c-border)" }, children: /* @__PURE__ */ jsxRuntime.jsx(DiffView, { diff: fileDiff, inline: ((_a2 = app.settings) == null ? void 0 : _a2.diffMode) === "inline" }) })
      ] }) : /* @__PURE__ */ jsxRuntime.jsx("div", { className: "empty-state", children: detailError ?? t("Log_SelectCommitHint") }) }) }) }),
      resetTarget && /* @__PURE__ */ jsxRuntime.jsx(
        Modal,
        {
          title: t("Log_ResetTitle"),
          confirmText: t("Log_ResetConfirm"),
          danger: resetMode === "hard",
          onClose: () => setResetTarget(null),
          onConfirm: () => void doReset(),
          children: /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { userSelect: "text" }, children: [
            /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
              t("Log_ResetBranchInfo", branches.current ?? "?"),
              " → ",
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mono", children: resetTarget.shortSha }),
              " ",
              resetTarget.subject
            ] }),
            ["soft", "mixed", "hard"].map((m) => /* @__PURE__ */ jsxRuntime.jsxs("label", { style: { display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8, cursor: "pointer" }, children: [
              /* @__PURE__ */ jsxRuntime.jsx(
                "input",
                {
                  type: "radio",
                  checked: resetMode === m,
                  onChange: () => setResetMode(m),
                  style: { marginTop: 2 }
                }
              ),
              /* @__PURE__ */ jsxRuntime.jsxs("span", { children: [
                /* @__PURE__ */ jsxRuntime.jsx("b", { style: { color: m === "hard" ? "var(--c-red)" : void 0 }, children: t(`Log_ResetMode_${m}`) }),
                /* @__PURE__ */ jsxRuntime.jsx("div", { style: { fontSize: 11, color: "var(--c-text2)" }, children: t(`Log_ResetDesc_${m}`) })
              ] })
            ] }, m)),
            resetMode === "hard" && /* @__PURE__ */ jsxRuntime.jsx("div", { style: { color: "var(--c-red)", fontSize: 11.5, marginTop: 8 }, children: t("Log_ResetHardWarning") })
          ] })
        }
      ),
      menuElement
    ] });
  }
  function FileRow({ file, active, onOpen }) {
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "list-row" + (active ? " selected" : ""), onClick: onOpen, children: [
      /* @__PURE__ */ jsxRuntime.jsx("span", { className: "status-letter st-" + file.statusCode, children: file.statusCode }),
      /* @__PURE__ */ jsxRuntime.jsx("span", { className: "trim", style: { flex: 1, fontFamily: "var(--mono)", fontSize: 12 }, children: file.path }),
      file.added !== null && /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "diff-stats-add", children: [
        "+",
        file.added
      ] }),
      file.deleted !== null && /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "diff-stats-del", children: [
        "−",
        file.deleted
      ] })
    ] });
  }
  window.GITTER_UI.registerPage({ id: "log" }, (container) => {
    var _a2;
    const host = container;
    (_a2 = host.__gitterRoot) == null ? void 0 : _a2.unmount();
    const root = ReactDOMClient.createRoot(container);
    root.render(
      React.createElement(PageErrorBoundary, {
        pageKey: "log",
        children: React.createElement(LogPage)
      })
    );
    host.__gitterRoot = root;
    return () => {
      host.__gitterRoot = void 0;
      root.unmount();
    };
  });
})(window.GITTER_KIT.ReactJSXRuntime, window.GITTER_KIT.React, window.GITTER_KIT.ReactDOM);
