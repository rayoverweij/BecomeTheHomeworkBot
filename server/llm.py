# Main driver file to prompt the model
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig, TextIteratorStreamer


class NeedHumanInputException(Exception):
	pass


class LLM:
	model_id = "meta-llama/Llama-3.1-8B-Instruct"
	# model_id = "Unispac/Gemma-2-9B-IT-With-Deeper-Safety-Alignment"
	# model_id = "meta-llama/Llama-3.2-3B-Instruct"
	
	num_choices = 5
	chat_history = []
	# system_prompt = "You are a chatbot simulating a resident of Leith, in Scotland. In recent years the demand for housing increased immensely in the whole city, as well as Leith. As a result, rent prices shot up immensely, and many landlords forced tenants out of their flats to capitalize on new rental contracts with higher rates. You and many close friends of your community lost your long-term homes and had to resettle to other parts of the city were you were still able to afford rent. You are incredibly bitter and sad about this development, and have strong opinions about people who have taken your old flat and the landlords who forced you out."
	system_prompt = "You are a chatbot named EdinBot. You're very knowledgeable about Edinburgh and give short responses to user queries."

	def __init__(self, device):
		self.device = device
		self.tokenizer = AutoTokenizer.from_pretrained(self.model_id)
		bnb_config = BitsAndBytesConfig(
			load_in_4bit=True
		)
		self.model = AutoModelForCausalLM.from_pretrained(
			self.model_id,
			device_map=device,
			attn_implementation="eager",
			quantization_config=bnb_config
		)
		self.tokenizer.pad_token = self.tokenizer.eos_token
		self.model.generation_config.pad_token_id = self.tokenizer.pad_token_id
		self.model.generation_config.return_dict_in_generate = True
		self.model.generation_config.output_scores = True
		self.model.generation_config.output_logits = True
		self.model.generation_config.do_sample = False

		self.streamer = TextIteratorStreamer(
			self.tokenizer, 
			skip_prompt=True, 
			decode_kwargs=dict(skip_special_tokens = True)
		)


	async def start_game(self, prompt: str, broadcast):
		# Reset how much we are allowed to generate
		self.max_new_tokens = 150

		messages = [
			{"role": "system", "content": self.system_prompt},
			{"role": "user", "content": prompt}
		]
		input_messages = self.tokenizer.apply_chat_template(messages, add_generation_prompt=True, tokenize=False)
		inputs = self.tokenizer(input_messages, return_tensors='pt').to(self.device)

		self.input_ids = inputs["input_ids"]
		self.num_tokens_input = self.input_ids.shape[-1]
		self.attention_mask = inputs["attention_mask"]
		self.top_1_threshold = 0.2
		self.default_top_1_threshold = 0.2
		self.threshold_increase = 0.02

		# Generate a token at a time
		while self.max_new_tokens > 0:
			try:
				await self.generate_next(broadcast)
				self.max_new_tokens -= 1
			except NeedHumanInputException:
				break

		if self.max_new_tokens == 0:
			await broadcast({ "type": "finish" })

	async def continue_game_with_input(self, input: int, broadcast):
		choice_index = input - 1
		choice = self.indices[choice_index]
		await self.finish_iteration(choice, broadcast)

		# Continue generating until we run out
		while self.max_new_tokens > 0:
			try:
				await self.generate_next(broadcast)
				self.max_new_tokens -= 1
			except NeedHumanInputException:
				break

		if self.max_new_tokens == 0:
			await broadcast({ "type": "finish" })

	async def generate_next(self, broadcast):
		generate_decoder_only_output = self.model.generate(
			input_ids=self.input_ids, 
			attention_mask=self.attention_mask, 
			max_new_tokens=1, 
			do_sample=False, 
			temperature=None, 
			top_p=None,
			exponential_decay_length_penalty=(self.max_new_tokens, 1.01),
		) # is now of type GenerateDecoderOnlyOutput

		# Softmax the scores and find the top-k tokens with their probabilities
		scores = generate_decoder_only_output["scores"][0]
		probs = torch.nn.functional.softmax(scores, dim=-1)
		topk, indices = torch.topk(probs, k=self.num_choices, dim=-1)
		topk = torch.squeeze(topk).tolist()
		self.indices = torch.squeeze(indices)

		# If highest probability is below 40% we branch
		if topk[0] < self.top_1_threshold:
			print(f"top-1 probability was {topk[0]}, which is smaller than {self.top_1_threshold}. Branching and resetting to {self.default_top_1_threshold}")
			self.top_1_threshold = self.default_top_1_threshold
			# For each of the options, send the text, index, and probability back
			# and save our progress in the game so we can pick up where we left off when we get input
			choices = []
			for i, pair in enumerate(zip(topk, self.indices)):
				prob, index = pair
				detokenized = self.tokenizer.decode(index, skip_special_tokens=True)
				choices.append({ "i": i, "index": int(index), "prob": prob, "token": detokenized })
			await broadcast({ "type": "inside_choice", "data": choices })
			raise NeedHumanInputException
		# Else just generate the next token
		else:
			print(f"top-1 probability was {topk[0]}, which is greater than {self.top_1_threshold}. We raise the threshold by {self.threshold_increase} and keep generating!")
			self.top_1_threshold += self.threshold_increase
			choice = self.indices[0]
			await self.finish_iteration(choice, broadcast)


	async def finish_iteration(self, choice, broadcast):
		choice = choice.unsqueeze(dim=0).unsqueeze(dim=0) # This is quite ugly but we effectively need it to have shape [1,1]
		self.input_ids = torch.cat((self.input_ids, choice), dim=1)
		self.attention_mask = torch.ones(1, self.input_ids.shape[-1]).to(self.device)
		detokenized_current_text = self.tokenizer.decode(self.input_ids.squeeze()[self.num_tokens_input:])
		detokenized_choice = self.tokenizer.decode(int(choice))

		print(detokenized_current_text)
		if "<|eot_id|>" in detokenized_current_text:
			await broadcast({ "type": "finish" })
			self.max_new_tokens = 0
			print("EOT was detected in output, ending generation...")
		else:
			await broadcast({ "type": "next_token", "data": detokenized_choice })
		# yield self.tokenizer.decode(int(choice))
