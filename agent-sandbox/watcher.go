package main

import (
	"fmt"
	"os"
	"strings"
	"time"
)

type fileStamp struct {
	exists  bool
	size    int64
	modTime time.Time
	err     string
}

func startRuntimeWatcher(app *App) func() {
	paths := []string{systemPromptPath, runtimeConfigPath}
	stamps := make(map[string]fileStamp, len(paths))
	for _, path := range paths {
		stamps[path] = getFileStamp(path)
	}

	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				var changed []string
				for _, path := range paths {
					next := getFileStamp(path)
					if next != stamps[path] {
						stamps[path] = next
						changed = append(changed, path)
					}
				}
				if len(changed) == 0 {
					continue
				}
				app.QueueReload()
				fmt.Printf("\n[detected runtime change in %s; queued reload]\n", strings.Join(changed, ", "))
			case <-done:
				return
			}
		}
	}()

	return func() {
		close(done)
	}
}

func getFileStamp(path string) fileStamp {
	info, err := os.Stat(path)
	if err == nil {
		return fileStamp{
			exists:  true,
			size:    info.Size(),
			modTime: info.ModTime(),
		}
	}
	if os.IsNotExist(err) {
		return fileStamp{}
	}
	return fileStamp{err: err.Error()}
}
