package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

func main() {
	addr := ":3001"
	if p := os.Getenv("PORT"); p != "" {
		addr = ":" + p
	}

	schema, err := loadSchema()
	if err != nil {
		log.Fatalf("failed to load schema: %v", err)
	}

	http.HandleFunc("/api/convert-resume", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req struct {
			PdfText string `json:"pdfText"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.PdfText == "" {
			http.Error(w, "missing pdfText", http.StatusBadRequest)
			return
		}

		result, err := runOpencode(req.PdfText, schema)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"yaml": result})
	})

	log.Printf("server listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}

func loadSchema() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	path := filepath.Join(filepath.Dir(exe), "..", "cv-data.yaml")

	if _, err := os.Stat(path); err != nil {
		wd, _ := os.Getwd()
		path = filepath.Join(wd, "cv-data.yaml")
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}

	var data yaml.Node
	if err := yaml.Unmarshal(raw, &data); err != nil {
		return "", err
	}

	var buf strings.Builder
	extractKeys(&buf, data.Content[0], 0)
	return buf.String(), nil
}

func extractKeys(buf *strings.Builder, node *yaml.Node, indent int) {
	pad := strings.Repeat("  ", indent)
	if node.Kind != yaml.MappingNode {
		return
	}
	for i := 0; i+1 < len(node.Content); i += 2 {
		key := node.Content[i].Value
		val := node.Content[i+1]

		switch val.Kind {
		case yaml.MappingNode:
			fmt.Fprintf(buf, "%s%s:\n", pad, key)
			extractKeys(buf, val, indent+1)
		case yaml.SequenceNode:
			fmt.Fprintf(buf, "%s%s:\n", pad, key)
			if len(val.Content) > 0 && val.Content[0].Kind == yaml.MappingNode {
				fmt.Fprintf(buf, "%s  -\n", pad)
				extractKeys(buf, val.Content[0], indent+2)
			} else {
				fmt.Fprintf(buf, "%s  - \"<string>\"\n", pad)
			}
		default:
			fmt.Fprintf(buf, "%s%s: \"<string>\"\n", pad, key)
		}
	}
}

func runOpencode(pdfText, schema string) (string, error) {
	prompt := buildPrompt(pdfText, schema)

	tmpFile, err := os.CreateTemp("", "resume-prompt-*.txt")
	if err != nil {
		return "", fmt.Errorf("creating temp file: %w", err)
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.WriteString(prompt); err != nil {
		tmpFile.Close()
		return "", fmt.Errorf("writing prompt: %w", err)
	}
	tmpFile.Close()

	cmd := exec.Command("opencode", "run", "@"+tmpFile.Name())
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("opencode failed: %s %s", err, stderr.String())
	}

	return extractYaml(stdout.String()), nil
}

func buildPrompt(pdfText, schema string) string {
	return fmt.Sprintf(`You are a resume-to-YAML converter. Convert the following resume text into YAML that exactly matches the schema below.

RULES:
- Output ONLY the YAML content, no explanations, no markdown fences
- Follow the schema structure exactly
- Preserve all dates, names, locations, and details from the resume
- Use the same field names as the schema
- If a field from the schema doesn't have a corresponding value in the resume, omit it entirely
- For skills and distinctions, use HTML formatting (<b>, <i>, <a>) as shown in the schema

SCHEMA:
%s

RESUME TEXT:
%s`, schema, pdfText)
}

var fencedRe = regexp.MustCompile("(?s)```(?:ya?ml)?\\s*\n(.*?)```")
var yamlStartRe = regexp.MustCompile(`^(name|contact|education|experience|skills):`)

func extractYaml(output string) string {
	if m := fencedRe.FindStringSubmatch(output); len(m) > 1 {
		return strings.TrimSpace(m[1])
	}

	lines := strings.Split(output, "\n")
	started := false
	var result []string
	for _, line := range lines {
		if !started && yamlStartRe.MatchString(line) {
			started = true
		}
		if started {
			result = append(result, line)
		}
	}
	if len(result) > 0 {
		return strings.TrimSpace(strings.Join(result, "\n"))
	}

	return strings.TrimSpace(output)
}
