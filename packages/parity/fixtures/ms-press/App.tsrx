export function App() @{
	<div class="bar">
		<style>
			.bar { padding: 4px; }
			.press { width: 90px; height: 24px; padding: 2px 8px; border: 2px solid #135; background-color: #48c; }
			.press:active { background-color: #236; border-color: #000; }
			.press:active .icon { width: 20px; background-color: #fc0; }
			.icon { width: 10px; height: 10px; background-color: #fff; }
		</style>
		<div class="press" role="button">
			<div class="icon"></div>
		</div>
	</div>
}
