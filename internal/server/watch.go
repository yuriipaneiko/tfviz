package server

import (
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/yuriipaneiko/tf-visualise/internal/config"
)

func relevantFile(name string) bool {
	return strings.HasSuffix(name, ".tf") || strings.HasSuffix(name, ".tfvars") ||
		strings.HasSuffix(name, ".tfvars.json") || strings.HasSuffix(name, ".tf.json") ||
		strings.HasSuffix(name, ".tfbackend") || strings.HasSuffix(name, ".config") ||
		(strings.HasSuffix(name, ".hcl") && !strings.HasSuffix(name, ".lock.hcl"))
}

func isDir(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

// watch reports changed Terraform files (debounced) until stop is closed.
func watch(dir string, stop <-chan struct{}, onChange func(files []string)) error {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	addTree := func(root string) {
		_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
			if err != nil || !d.IsDir() {
				return nil
			}
			if p != dir && config.ShouldSkipDir(d.Name()) {
				return filepath.SkipDir
			}
			_ = w.Add(p)
			return nil
		})
	}
	addTree(dir)

	go func() {
		defer w.Close()
		var mu sync.Mutex
		pending := map[string]bool{}
		var timer *time.Timer
		flush := func() {
			mu.Lock()
			files := make([]string, 0, len(pending))
			for f := range pending {
				files = append(files, f)
			}
			pending = map[string]bool{}
			mu.Unlock()
			if len(files) > 0 {
				onChange(files)
			}
		}
		for {
			select {
			case <-stop:
				return
			case err, ok := <-w.Errors:
				if !ok {
					return
				}
				log.Printf("watch: %v", err)
			case ev, ok := <-w.Events:
				if !ok {
					return
				}
				base := filepath.Base(ev.Name)
				relevant := relevantFile(base) && !strings.HasPrefix(base, ".")
				if ev.Has(fsnotify.Create) && isDir(ev.Name) && !config.ShouldSkipDir(base) {
					addTree(ev.Name)
					relevant = true
				}
				// A removed directory can't be stat'ed; extension-less names are most likely directories.
				if (ev.Has(fsnotify.Remove) || ev.Has(fsnotify.Rename)) && filepath.Ext(base) == "" && !config.ShouldSkipDir(base) {
					relevant = true
				}
				if !relevant {
					continue
				}
				mu.Lock()
				pending[ev.Name] = true
				if timer != nil {
					timer.Stop()
				}
				timer = time.AfterFunc(300*time.Millisecond, flush)
				mu.Unlock()
			}
		}
	}()
	return nil
}
