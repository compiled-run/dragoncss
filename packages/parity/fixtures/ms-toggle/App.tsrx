export function App() @{
	<div class="list">
		<style>
			.list { padding: 4px; }
		</style>
		<Chip />
	</div>
}

export function Chip() @{
	let selected = state(false);
	<div class={selected ? 'chip selected' : 'chip'}>
		<style>
			.chip { width: 80px; height: 20px; padding: 2px 6px; border: 1px solid #888; border-radius: 6px; background-color: #fff; }
			.chip.selected { padding: 4px 10px; border-color: #06c; border-width: 2px; background-color: #def; }
			.dot { width: 8px; height: 8px; background-color: #888; }
			.chip.selected .dot { width: 16px; background-color: #06c; }
		</style>
		<div class="dot"></div>
	</div>
}
