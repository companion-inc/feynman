declare module "promise.try" {
	function promiseTry<T>(callback: () => T | PromiseLike<T>): Promise<T>;
	namespace promiseTry {
		function shim(): void;
	}
	export default promiseTry;
}
