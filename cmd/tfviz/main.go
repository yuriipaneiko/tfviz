// Command tfviz visualises Terraform code and plans in the browser.
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/pkg/browser"
	"github.com/yuriipaneiko/tf-visualise/internal/server"
	"github.com/yuriipaneiko/tf-visualise/web"
)

func main() {
	port := flag.Int("port", 7777, "port to listen on (the next free port is used if taken)")
	host := flag.String("host", "127.0.0.1", "interface to bind to")
	noOpen := flag.Bool("no-open", false, "don't open the browser")
	noWatch := flag.Bool("no-watch", false, "don't reload when .tf files change")
	dev := flag.Bool("dev", false, "API only; serve the UI with Vite (make dev)")
	tfBin := flag.String("terraform", "", "terraform binary to use (e.g. tofu)")
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage: tfviz [flags] [path]\n\nVisualise Terraform code and plans.\npath defaults to the current directory and may contain many root modules.\n\nFlags:\n")
		flag.PrintDefaults()
	}
	flag.Parse()

	dir := "."
	if flag.NArg() > 0 {
		dir = flag.Arg(0)
	}
	if st, err := os.Stat(dir); err != nil || !st.IsDir() {
		log.Fatalf("%s is not a directory", dir)
	}

	opts := server.Options{ProjectDir: dir, TerraformBin: *tfBin, Watch: !*noWatch}
	if !*dev {
		opts.UI = web.Dist()
	}
	srv, err := server.New(opts)
	if err != nil {
		log.Fatal(err)
	}
	defer srv.Close()

	roots := 0
	for _, s := range srv.Stacks() {
		if s.Kind == "root" {
			roots++
		}
	}
	if len(srv.Stacks()) == 0 {
		log.Printf("warning: no .tf files found under %s", dir)
	}

	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		<-sig
		srv.Close()
		os.Exit(0)
	}()

	err = srv.Serve(*host, *port, func(url string) {
		fmt.Printf("\n  tfviz  ·  %d stacks (%d roots) in %s\n\n  ➜  %s\n\n", len(srv.Stacks()), roots, dir, url)
		if !*noOpen && !*dev {
			_ = browser.OpenURL(url)
		}
	})
	if err != nil {
		log.Fatal(err)
	}
}
