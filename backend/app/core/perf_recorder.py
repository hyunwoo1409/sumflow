
import time

class _PerfScope:
    def __init__(self):
        self._t = None
        self._events = []

    def __enter__(self):
        self._t = time.time()
        return self

    def mark(self, name: str):
        if self._t is None:
            return
        ms = int((time.time() - self._t) * 1000)
        self._events.append({"name": name, "ms": ms})

    def __exit__(self, exc_type, exc, tb):
        self.mark("total")

    def dump(self):
        return self._events

def perf_scope():
    return _PerfScope()
