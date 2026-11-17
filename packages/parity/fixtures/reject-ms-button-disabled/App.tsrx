export function App() @{
	<div class="bar">
		<style>
			.bar { padding: 4px; }
		</style>
		<Button />
	</div>
}

export function Button() @{
	let disabled = state(false);
	<button type="button" class="button" disabled={disabled}>
		<style>
			.button { display: block; font: inherit; width: 90px; height: 24px; padding: 2px 8px; border: 2px solid #135; background-color: #48c; }
			.button:active { background-color: #236; border-color: #000; }
			.button:disabled { background-color: #aab; border-color: #889; }
		</style>
	</button>
}
