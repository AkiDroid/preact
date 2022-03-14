import { diffChildren, insertComponentDom } from './children';
import { setProperty } from './props';
import options from '../options';
import { renderClassComponent, renderFunctionComponent } from './component';
import {
	RESET_MODE,
	TYPE_TEXT,
	TYPE_ELEMENT,
	MODE_SUSPENDED,
	MODE_ERRORED,
	TYPE_ROOT,
	TYPE_CLASS,
	MODE_SVG,
	UNDEFINED,
	MODE_HYDRATE,
	MODE_PENDING_ERROR,
	MODE_RERENDERING_ERROR,
	SKIP_CHILDREN,
	DIRTY_BIT
} from '../constants';
import { getDomSibling } from '../tree';
import { mountChildren } from './mount';
import { Fragment } from '../create-element';
import { rendererState } from '../component';

/**
 * Diff two virtual nodes and apply proper changes to the DOM
 * @param {import('../internal').VNode | string} newVNode The new virtual node
 * @param {import('../internal').Internal} internal The Internal node to patch
 */
export function patch(newVNode, internal) {
	let dom = internal._dom;
	let flags = internal.flags;

	if (flags & TYPE_TEXT) {
		if (newVNode !== internal.props) {
			dom.data = newVNode;
			internal.props = newVNode;
		}

		return;
	}

	// When passing through createElement it assigns the object
	// constructor as undefined. This to prevent JSON-injection.
	if (newVNode.constructor !== UNDEFINED) return null;

	if (options._diff) options._diff(internal, newVNode);

	if (flags & TYPE_ELEMENT) {
		if (newVNode._vnodeId !== internal._vnodeId) {
			// @ts-ignore dom is a PreactElement here
			patchDOMElement(dom, newVNode, internal);
			// Once we have successfully rendered the new VNode, copy it's ID over
			internal._vnodeId = newVNode._vnodeId;
		}

		if (options.diffed) options.diffed(internal);

		// We successfully rendered this VNode, unset any stored hydration/bailout state:
		internal.flags &= RESET_MODE;
	}

	/** @type {import('../index').ComponentChild} */
	let nextDomSibling;

	// Root nodes signal that an attempt to render into a specific DOM node on
	// the page. Root nodes can occur anywhere in the tree and not just at the
	// top.
	let prevParentDom = rendererState._parentDom;
	if (flags & TYPE_ROOT) {
		rendererState._parentDom = newVNode.props._parentDom;

		if (internal.props._parentDom !== newVNode.props._parentDom) {
			let nextSibling =
				rendererState._parentDom == prevParentDom
					? getDomSibling(internal)
					: null;
			insertComponentDom(internal, nextSibling, rendererState._parentDom);
		}
	}

	try {
		if (internal.flags & MODE_PENDING_ERROR) {
			// Toggle the MODE_PENDING_ERROR and MODE_RERENDERING_ERROR flags. In
			// actuality, this should turn off the MODE_PENDING_ERROR flag and turn on
			// the MODE_RERENDERING_ERROR flag.
			internal.flags ^= MODE_PENDING_ERROR | MODE_RERENDERING_ERROR;
		}

		let prevContext = rendererState._context;
		// Necessary for createContext api. Setting this property will pass
		// the context value as `this.context` just for this component.
		let tmp = newVNode.type.contextType;
		let provider = tmp && rendererState._context[tmp._id];
		let componentContext = tmp
			? provider
				? provider.props.value
				: tmp._defaultValue
			: rendererState._context;
		let isNew = !internal || !internal._component;

		if (internal.flags & TYPE_CLASS) {
			nextDomSibling = renderClassComponent(
				newVNode,
				internal,
				componentContext
			);
		} else {
			nextDomSibling = renderFunctionComponent(
				newVNode,
				internal,
				componentContext
			);
		}

		if (internal.flags & SKIP_CHILDREN) {
			internal.props = newVNode.props;
			internal.flags &= ~SKIP_CHILDREN;
			// More info about this here: https://gist.github.com/JoviDeCroock/bec5f2ce93544d2e6070ef8e0036e4e8
			if (newVNode && newVNode._vnodeId !== internal._vnodeId) {
				internal.flags &= ~DIRTY_BIT;
			}
		} else {
			let isTopLevelFragment =
				nextDomSibling != null &&
				nextDomSibling.type === Fragment &&
				nextDomSibling.key == null;
			let renderResult = isTopLevelFragment
				? nextDomSibling.props.children
				: nextDomSibling;

			if (internal._children == null) {
				mountChildren(
					Array.isArray(renderResult) ? renderResult : [renderResult],
					internal,
					(internal.flags & (MODE_HYDRATE | MODE_SUSPENDED)) ===
						(MODE_HYDRATE | MODE_SUSPENDED)
						? internal._dom
						: isNew || internal.flags & MODE_HYDRATE
						? null
						: getDomSibling(internal)
				);
			} else {
				diffChildren(
					Array.isArray(renderResult) ? renderResult : [renderResult],
					internal
				);
			}
		}

		if (internal._commitCallbacks != null && internal._commitCallbacks.length) {
			rendererState._commitQueue.push(internal);
		}

		rendererState._parentDom = prevParentDom;

		// In the event this subtree creates a new context for its children, restore
		// the previous context for its siblings
		rendererState._context = prevContext;
	} catch (e) {
		// @TODO: assign a new VNode ID here? Or NaN?
		// newVNode._vnodeId = 0;
		internal.flags |= e.then ? MODE_SUSPENDED : MODE_ERRORED;
		options._catchError(e, internal);
	}

	if (options.diffed) options.diffed(internal);

	// We successfully rendered this VNode, unset any stored hydration/bailout state:
	internal.flags &= RESET_MODE;
	// Once we have successfully rendered the new VNode, copy it's ID over
	internal._vnodeId = newVNode._vnodeId;
}

/**
 * Diff two virtual nodes representing DOM element
 * @param {import('../internal').PreactElement} dom The DOM element representing
 * the virtual nodes being diffed
 * @param {import('../internal').VNode} newVNode The new virtual node
 * @param {import('../internal').Internal} internal The Internal node to patch
 */
function patchDOMElement(dom, newVNode, internal) {
	let oldProps = internal.props,
		newProps = (internal.props = newVNode.props),
		isSvg = internal.flags & MODE_SVG,
		i,
		value,
		tmp,
		newHtml,
		oldHtml,
		newChildren;

	for (i in oldProps) {
		value = oldProps[i];
		if (i === 'key') {
		} else if (i === 'children') {
		} else if (i === 'dangerouslySetInnerHTML') {
			oldHtml = value;
		} else if (!(i in newProps)) {
			setProperty(dom, i, null, value, isSvg);
		}
	}

	for (i in newProps) {
		value = newProps[i];
		if (i === 'key') {
		} else if (i === 'children') {
			newChildren = value;
		} else if (i === 'dangerouslySetInnerHTML') {
			newHtml = value;
		} else if (
			value !== (tmp = oldProps[i]) ||
			((i === 'checked' || i === 'value') && value != null && value !== dom[i])
		) {
			setProperty(dom, i, value, tmp, isSvg);
		}
	}

	// If the new vnode didn't have dangerouslySetInnerHTML, diff its children
	if (newHtml) {
		value = newHtml.__html;
		// Avoid re-applying the same '__html' if it did not changed between re-render
		if (!oldHtml || (value !== oldHtml.__html && value !== dom.innerHTML)) {
			dom.innerHTML = value;
		}
		internal._children = null;
	} else {
		if (oldHtml) dom.innerHTML = '';
		const prevParentDom = rendererState._parentDom;
		rendererState._parentDom = dom;
		diffChildren(
			newChildren && Array.isArray(newChildren) ? newChildren : [newChildren],
			internal,
			dom.firstChild
		);
		rendererState._parentDom = prevParentDom;
	}

	if (newProps.value != null && dom._isControlled) {
		dom._prevValue = newProps.value;
	} else if (newProps.checked != null && dom._isControlled) {
		dom._prevValue = newProps.checked;
	}
}
