package tools

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type DeepResearchTool struct {
	RunSubagent func(systemPrompt, taskPrompt string) (string, error)
	Workspace   string
}

func (t *DeepResearchTool) Name() string { return "deep_research" }

func (t *DeepResearchTool) Description() string {
	return "Conduct deep research on a topic. Generates an outline, spawns researcher subagents to gather evidence at configurable breadth and depth, then synthesizes findings into a report at research/report.md."
}

func (t *DeepResearchTool) Schema() map[string]any {
	return BuildSchema([]Param{
		{Name: "query", Type: "string", Description: "The research topic or question", Required: true},
		{Name: "breadth", Type: "integer", Description: "Number of subtopics to explore per level (default: 3)"},
		{Name: "depth", Type: "integer", Description: "Maximum rounds of follow-up research (default: 2)"},
	})
}

type researchMemory struct {
	QueriesUsed []string
	URLsVisited []string
}

func (m *researchMemory) addQueries(queries []string) {
	m.QueriesUsed = append(m.QueriesUsed, queries...)
}

func (m *researchMemory) addURLs(urls []string) {
	m.URLsVisited = append(m.URLsVisited, urls...)
}

func (m *researchMemory) querySummary() string {
	if len(m.QueriesUsed) == 0 {
		return "None yet."
	}
	return "- " + strings.Join(m.QueriesUsed, "\n- ")
}

func (m *researchMemory) urlSummary() string {
	if len(m.URLsVisited) == 0 {
		return "None yet."
	}
	return "- " + strings.Join(m.URLsVisited, "\n- ")
}

type researchResult struct {
	Summary           string   `json:"summary"`
	FollowUpQuestions []string `json:"follow_up_questions"`
	QueriesUsed       []string `json:"queries_used"`
	URLsFound         []string `json:"urls_found"`
}

func (t *DeepResearchTool) Execute(args map[string]any) string {
	query, _ := args["query"].(string)
	if query == "" {
		return "Error: query is required"
	}

	breadth := 3
	if b, ok := args["breadth"].(float64); ok && b > 0 {
		breadth = int(b)
	}
	depth := 2
	if d, ok := args["depth"].(float64); ok && d > 0 {
		depth = int(d)
	}

	researchDir := filepath.Join(t.Workspace, "research")
	evidenceDir := filepath.Join(researchDir, "evidence")
	_ = os.MkdirAll(evidenceDir, 0o755)

	// Phase 1: Generate outline
	sections, err := t.generateOutline(query, breadth)
	if err != nil {
		return fmt.Sprintf("Error generating outline: %v", err)
	}

	outlineData, _ := json.MarshalIndent(map[string]any{
		"query": query, "sections": sections, "breadth": breadth, "depth": depth,
	}, "", "  ")
	_ = os.WriteFile(filepath.Join(researchDir, "outline.json"), outlineData, 0o644)

	// Phase 2: Recursive research
	memory := &researchMemory{}
	fileIndex := 0

	for currentDepth := 0; currentDepth < depth; currentDepth++ {
		var nextSections []string

		for _, section := range sections {
			fileIndex++
			evidencePath := fmt.Sprintf("research/evidence/%02d_%s.md", fileIndex, sanitizeFilename(section))

			result, err := t.researchTopic(query, section, evidencePath, memory)
			if err != nil {
				continue
			}

			memory.addQueries(result.QueriesUsed)
			memory.addURLs(result.URLsFound)

			if currentDepth < depth-1 {
				limit := min(breadth, len(result.FollowUpQuestions))
				nextSections = append(nextSections, result.FollowUpQuestions[:limit]...)
			}
		}

		sections = nextSections
		if len(sections) == 0 {
			break
		}
	}

	// Phase 3: Synthesize
	if err := t.synthesize(query); err != nil {
		return fmt.Sprintf("Evidence collected (%d files) but synthesis failed: %v", fileIndex, err)
	}

	return fmt.Sprintf("Deep research complete. Report: research/report.md (%d evidence files, %d queries, %d URLs)",
		fileIndex, len(memory.QueriesUsed), len(memory.URLsVisited))
}

func (t *DeepResearchTool) generateOutline(query string, breadth int) ([]string, error) {
	systemPrompt := "You are a research planner. Given a research topic, generate specific subtopics to investigate. Respond with ONLY a JSON array of strings, no other text."
	taskPrompt := fmt.Sprintf("Generate exactly %d specific subtopics or questions to research for:\n\n%s\n\nRespond with a JSON array of strings only, e.g. [\"subtopic 1\", \"subtopic 2\"]", breadth, query)

	result, err := t.RunSubagent(systemPrompt, taskPrompt)
	if err != nil {
		return nil, err
	}

	var sections []string
	start := strings.Index(result, "[")
	end := strings.LastIndex(result, "]")
	if start >= 0 && end > start {
		if err := json.Unmarshal([]byte(result[start:end+1]), &sections); err == nil {
			return sections, nil
		}
	}

	// Fallback: split by newlines
	for _, line := range strings.Split(result, "\n") {
		line = strings.TrimSpace(line)
		line = strings.TrimLeft(line, "0123456789.-) ")
		if line != "" {
			sections = append(sections, line)
		}
	}
	if len(sections) == 0 {
		return nil, fmt.Errorf("failed to parse outline from response")
	}
	return sections, nil
}

func (t *DeepResearchTool) researchTopic(originalQuery, topic, evidencePath string, memory *researchMemory) (*researchResult, error) {
	systemPrompt := `You are a research collector. Your job is to research a topic using web_search and write findings to a file.

Instructions:
1. Use web_search with multiple different queries to find information about the topic.
2. Write your detailed findings to the specified file using write_file. Include source URLs and key facts.
3. After writing the evidence file, respond with ONLY a JSON object:
{"summary": "brief summary", "follow_up_questions": ["q1", "q2", "q3"], "queries_used": ["query1", "query2"], "urls_found": ["url1", "url2"]}`

	taskPrompt := fmt.Sprintf(`Research this topic: %s
Original research context: %s

Write findings to: %s

Already searched queries (DO NOT repeat):
%s

Already visited URLs (skip if possible):
%s

Research thoroughly, write findings to the file, then respond with the JSON summary.`,
		topic, originalQuery, evidencePath, memory.querySummary(), memory.urlSummary())

	result, err := t.RunSubagent(systemPrompt, taskPrompt)
	if err != nil {
		return nil, err
	}

	var rr researchResult
	start := strings.Index(result, "{")
	end := strings.LastIndex(result, "}")
	if start >= 0 && end > start {
		if err := json.Unmarshal([]byte(result[start:end+1]), &rr); err == nil {
			return &rr, nil
		}
	}

	return &researchResult{Summary: result}, nil
}

func (t *DeepResearchTool) synthesize(query string) error {
	systemPrompt := `You are a research synthesizer. Read all evidence files and produce a well-structured research report.

Instructions:
1. Use glob with pattern "research/evidence/*.md" to find all evidence files.
2. Use read_file to read each one.
3. Synthesize all findings into a comprehensive, well-organized report with clear sections and source citations.
4. Write the report to research/report.md using write_file.`

	taskPrompt := fmt.Sprintf(`Synthesize all research evidence into a comprehensive report.

Original research query: %s
Evidence location: research/evidence/
Output: research/report.md

Read all evidence files, then write a well-structured report with sections, key findings, and source URLs.`, query)

	_, err := t.RunSubagent(systemPrompt, taskPrompt)
	return err
}

func sanitizeFilename(name string) string {
	name = strings.ToLower(name)
	var b strings.Builder
	for _, c := range name {
		switch {
		case c >= 'a' && c <= 'z', c >= '0' && c <= '9':
			b.WriteRune(c)
		case c == ' ', c == '-', c == '_':
			b.WriteRune('_')
		}
	}
	result := b.String()
	if len(result) > 50 {
		result = result[:50]
	}
	return result
}
