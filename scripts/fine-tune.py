"""
AgentX TinyLlama Fine-tuning Script

Fine-tunes TinyLlama with custom coding data using LoRA.
"""

import os
import json
import argparse
from pathlib import Path

def load_training_data(data_dir):
    """Load all JSONL training files and combine them."""
    combined = []
    data_path = Path(data_dir)
    
    for jsonl_file in data_path.glob("*.jsonl"):
        print(f"Loading {jsonl_file.name}...")
        with open(jsonl_file, 'r') as f:
            for line in f:
                if line.strip():
                    try:
                        combined.append(json.loads(line))
                    except json.JSONDecodeError:
                        print(f"Warning: Skipping invalid JSON in {jsonl_file.name}")
    
    print(f"Total training examples: {len(combined)}")
    return combined

def prepare_training_data(data):
    """Prepare data for training - format for fine-tuning."""
    formatted = []
    
    for item in data:
        messages = item.get('messages', [])
        if len(messages) >= 2:
            # Find system prompt and user/assistant pairs
            system = ""
            conversation = []
            
            for msg in messages:
                role = msg.get('role', '')
                content = msg.get('content', '')
                
                if role == 'system':
                    system = content
                elif role == 'user':
                    conversation.append({"role": "user", "content": content})
                elif role == 'assistant':
                    conversation.append({"role": "assistant", "content": content})
            
            if system and len(conversation) >= 1:
                formatted.append({
                    "system": system,
                    "conversations": conversation
                })
    
    return formatted

def main():
    parser = argparse.ArgumentParser(description='Fine-tune TinyLlama for AgentX')
    parser.add_argument('--model', default='tinyllama', help='Base model name')
    parser.add_argument('--data', default='training-data/', help='Training data directory')
    parser.add_argument('--output', default='models/agentx-tinyllama-bot/', help='Output directory')
    parser.add_argument('--quantize', type=int, default=4, choices=[4, 8], help='Quantization bits')
    
    args = parser.parse_args()
    
    print(f"Loading training data from {args.data}...")
    raw_data = load_training_data(args.data)
    training_data = prepare_training_data(raw_data)
    
    print(f"Prepared {len(training_data)} training examples")
    print(f"\nNote: This is a placeholder script.")
    print(f"Actual fine-tuning requires:")
    print(f"  pip install unsloth transformers torch accelerate bitsandbytes")
    print(f"  python -m unsloth.tinyllama {args.data} --output {args.output} --quantize {args.quantize}")

if __name__ == '__main__':
    main()